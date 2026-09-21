/* Review fixture only. No production imports, network requests, or provider APIs. */
const KEY = 'happyherd-issue-300-mock-v1';
const defaults = { machine: 'studio-mac', provider: 'codex', model: 'gpt-5', path: '/workspace/demo', account: 'saved-default' };
const seed = () => ({
    simplified: false, selected: null, chatOpen: false, scenario: 'ready', drafts: {}, receipt: null,
    bots: [{ id: 'atlas', name: 'Atlas', purpose: 'Build and debug with a steady partner' }, { id: 'sage', name: 'Sage', purpose: 'Explore ideas and turn research into plans' }],
    sessions: [{ id: 'existing-1', bot: 'atlas', title: 'Plan the next release', messages: [{ role: 'user', text: 'Help me plan the next release.', files: [] }, { role: 'assistant', text: 'Simulated reply: Let’s start with the release goals and open questions.', files: [] }], defaults: { ...defaults } }],
});
let state;
try { state = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { state = seed(); }
let busy = false;
let query = '';
let failure = '';
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { $('attachment-status').textContent = 'Mock storage is full or unavailable. Keep this tab open; remove attachments to save across reloads.'; }
}
function activeSession() { return state.sessions.find((s) => s.id === state.selected); }
function activeBot() { return state.bots.find((b) => b.id === (activeSession()?.bot || state.selected)); }
function draft() { return state.drafts[state.selected] ||= { text: '', files: [], request: null }; }
function attachmentHTML(file, index, removable = false) {
    return `<span class="attachment">${file.image ? `<img src="${esc(file.image)}" alt="Preview of ${esc(file.name)}">` : '↗'}<span>${esc(file.name)}</span>${removable ? `<button type="button" data-remove="${index}" aria-label="Remove ${esc(file.name)}">×</button>` : ''}</span>`;
}
function renderLibrary() {
    const matches = (text) => text.toLowerCase().includes(query.toLowerCase());
    const bots = state.bots.filter((b) => matches(`${b.name} ${b.purpose}`));
    $('bots').innerHTML = bots.map((b) => `<button class="item" data-select="${b.id}" aria-pressed="${state.selected === b.id}"><span class="avatar">${esc(b.name.slice(0, 1))}</span><span>${esc(b.name)}<small>${esc(b.purpose || 'Your Commander')}</small></span></button>`).join('') || '<p class="muted">No matching bots. Try another name or create a Commander.</p>';
    const recents = state.sessions.filter((s) => matches(`${s.title} ${state.bots.find((b) => b.id === s.bot)?.name}`));
    $('recents').innerHTML = recents.map((s) => `<button class="item" data-select="${s.id}" aria-pressed="${state.selected === s.id}"><span>↩</span><span>${esc(s.title)}<small>${esc(state.bots.find((b) => b.id === s.bot)?.name)} · Existing chat</small></span></button>`).join('') || '<p class="muted">No matching chats.</p>';
}
function render() {
    const bot = activeBot();
    const session = activeSession();
    $('mode-label').textContent = state.simplified ? 'Simplified · Experimental' : 'Standard view';
    $('library-title').textContent = state.simplified ? 'Your bots' : 'Sessions';
    $('simplified').checked = state.simplified;
    $('shell').classList.toggle('chat-open', state.chatOpen);
    $('standard').hidden = state.simplified;
    $('connection').textContent = Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join(' · ');
    $('settings-defaults').textContent = state.scenario === 'missing' ? 'Saved defaults unavailable. No alternate machine or account will be selected.' : state.scenario === 'offline' ? 'studio-mac is unavailable. Reconnect the saved machine, then retry.' : Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join(' · ');
    $('chat-title').textContent = bot?.name || 'Choose a Commander';
    $('chat-subtitle').textContent = session ? `Existing chat · ${session.id}` : bot ? 'New conversation · created only when you send' : 'One place for your bots and recent chats';
    $('new-chat').hidden = !session;
    $('composer').hidden = !bot;
    $('messages').innerHTML = session ? session.messages.map((m) => `<article class="message ${m.role}"><strong>${m.role === 'user' ? 'You' : esc(bot.name)}</strong>${esc(m.text)}<div>${m.files.map((f, i) => attachmentHTML(f, i)).join('')}</div></article>`).join('') : `<div class="empty"><div class="avatar" style="margin:auto">${bot ? esc(bot.name.slice(0, 1)) : '✦'}</div><h2>${bot ? `Start with ${esc(bot.name)}` : 'Who can help today?'}</h2><p>${bot ? esc(bot.purpose || 'Your Commander is ready to help.') : 'Choose a bot or pick up a recent conversation.'}</p><p>Choosing or typing creates no empty chat.</p></div>`;
    if (bot) {
        $('draft').value = draft().text;
        $('attachments').innerHTML = draft().files.map((f, i) => attachmentHTML(f, i, true)).join('');
    }
    $('draft-hint').textContent = session ? '· saved to this chat' : '· draft saved until sent';
    $('draft').disabled = busy;
    $('files').disabled = busy;
    $('send').disabled = busy;
    $('send').textContent = busy ? 'Sending…' : 'Send';
    $('error').hidden = !failure;
    $('error').innerHTML = failure ? `<strong>Couldn’t send</strong><div>${esc(failure)} Your draft and attachments are retained.</div><button id="retry" ${busy ? 'disabled' : ''}>Retry send</button><button id="open-defaults">Open settings</button>` : '';
    $('scenario').value = state.scenario;
    $('counts').textContent = `${state.sessions.length} sessions · ${state.bots.length} Commanders`;
    $('receipt').textContent = JSON.stringify(state.receipt || { note: 'Send a first message to inspect the simulated launch receipt.', defaults }, null, 2);
    renderLibrary();
}
function select(id) {
    if (busy) return;
    state.selected = id; state.chatOpen = true; failure = ''; save(); render();
}
async function send() {
    if (busy || !activeBot()) return;
    const pending = draft();
    if (!pending.text.trim() && !pending.files.length) { $('draft').focus(); return; }
    const selection = state.selected;
    const bot = activeBot();
    const existing = activeSession();
    const scenario = state.scenario;
    pending.request ||= crypto.randomUUID();
    busy = true; failure = ''; save(); render();
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (!existing && ['missing', 'offline', 'failure'].includes(scenario)) {
        failure = { missing: 'Saved connection defaults are missing. Restore them in Settings before retrying.', offline: 'The saved machine studio-mac is unavailable. Reconnect it in Settings before retrying.', failure: 'The launch failed temporarily. Retry with the same saved defaults.' }[scenario];
        if (scenario === 'failure') state.scenario = 'ready';
    } else {
        // A simulated request ID survives errors/reload. Lost acknowledgement retries
        // locate the same session; no real distributed idempotency is claimed here.
        let session = existing || state.sessions.find((s) => s.request === pending.request);
        if (!session) {
            session = { id: `mock-${crypto.randomUUID().slice(0, 8)}`, bot: bot.id, title: pending.text.trim().slice(0, 48) || pending.files[0].name, request: pending.request, defaults: { ...defaults }, messages: [] };
            state.sessions.unshift(session);
        }
        state.receipt = { simulated: true, requestId: pending.request, sessionId: session.id, commanderId: bot.id, defaults: session.defaults, sessionCount: state.sessions.length };
        if (!existing && scenario === 'lost') {
            state.scenario = 'ready';
            failure = 'The session was created but its response was lost. Retry reuses that session and sends your preserved draft.';
        } else {
            session.messages.push({ role: 'user', text: pending.text, files: [...pending.files] }, { role: 'assistant', text: 'Simulated reply: Message received. We can continue here using the same chat.', files: [] });
            delete state.drafts[selection];
            state.selected = session.id;
            state.sessions = [session, ...state.sessions.filter((s) => s.id !== session.id)];
        }
    }
    busy = false; save(); render(); $('messages').scrollTop = $('messages').scrollHeight;
}
$('settings').onclick = () => $('settings-dialog').showModal();
$('simplified').onchange = (e) => { state.simplified = e.target.checked; save(); render(); };
$('repair').onclick = () => { state.scenario = 'ready'; save(); render(); };
$('create').onclick = () => { $('create-form').reset(); $('create-dialog').showModal(); $('name').focus(); };
$('cancel-create').onclick = () => $('create-dialog').close();
$('create-form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) { $('name').setCustomValidity('Enter a Commander name.'); $('name').reportValidity(); return; }
    const bot = { id: `bot-${crypto.randomUUID()}`, name, purpose: $('purpose').value.trim() };
    state.bots.push(bot); $('create-dialog').close(); query = ''; $('search').value = ''; select(bot.id);
};
$('name').oninput = () => $('name').setCustomValidity('');
$('library').onclick = (e) => { const button = e.target.closest('[data-select]'); if (button) select(button.dataset.select); };
$('search').oninput = (e) => { query = e.target.value; renderLibrary(); };
$('back').onclick = () => { state.chatOpen = false; save(); render(); };
$('new-chat').onclick = () => select(activeBot().id);
$('draft').oninput = (e) => { draft().text = e.target.value; save(); };
$('composer').onsubmit = (e) => { e.preventDefault(); send(); };
$('draft').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } };
$('files').onchange = async (e) => {
    if (busy) return;
    const target = draft();
    const files = [...e.target.files];
    const notices = [];
    busy = true; render();
    for (const file of files) {
        if (target.files.length >= 5 || file.size > 1024 * 1024) { notices.push('Mock limit: 5 files, 1 MB each.'); continue; }
        const image = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(null); reader.readAsDataURL(file); }) : null;
        target.files.push({ name: file.name, size: file.size, image });
    }
    e.target.value = ''; busy = false; save(); render(); $('attachment-status').textContent = notices.join(' ') || 'Attached locally. Non-image files retain name/size only; nothing is uploaded.';
};
$('attachments').onclick = (e) => { const button = e.target.closest('[data-remove]'); if (button && !busy) { draft().files.splice(Number(button.dataset.remove), 1); save(); render(); } };
$('error').onclick = (e) => { if (e.target.id === 'retry') send(); if (e.target.id === 'open-defaults') $('settings-dialog').showModal(); };
$('scenario').onchange = (e) => { state.scenario = e.target.value; save(); render(); };
$('reset').onclick = () => { if (!busy && confirm('Reset only this prototype’s local data?')) { state = seed(); failure = ''; query = ''; $('search').value = ''; save(); render(); } };
render();
