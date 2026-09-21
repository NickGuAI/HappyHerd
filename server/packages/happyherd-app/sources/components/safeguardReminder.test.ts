import { describe, expect, it } from 'vitest';
import { parseSafeguardReminder } from './safeguardReminder';

const tag = 'happyherd-safeguard-reminder';
const ready = `<${tag} status="ready">No obvious issue found.</${tag}>`;
const revise = `<${tag} status="revise"><quote>Delete all files</quote><suggestion>Specify the target folder.</suggestion></${tag}>`;

describe('parseSafeguardReminder', () => {
    it('extracts a complete ready reminder at the beginning of a reply', () => {
        expect(parseSafeguardReminder(` \n${ready}\n\nPlease approve.`)).toEqual({
            reminder: { status: 'ready', summary: 'No obvious issue found.' },
            text: '\n\nPlease approve.',
        });
    });

    it('extracts one or more ordered quote and suggestion pairs', () => {
        const body = '\n<quote>Delete all files</quote>\n<suggestion>Specify the target folder.</suggestion>'
            + '\n<quote>Publish it</quote><suggestion>Identify the destination.</suggestion>\n';
        expect(parseSafeguardReminder(`<${tag} status='revise'>${body}</${tag}>`)).toEqual({
            reminder: {
                status: 'revise',
                issues: [
                    { quote: 'Delete all files', suggestion: 'Specify the target folder.' },
                    { quote: 'Publish it', suggestion: 'Identify the destination.' },
                ],
            },
            text: '',
        });
    });

    it('accepts single quotes and whitespace around the status assignment', () => {
        expect(parseSafeguardReminder(`<${tag}\nstatus = 'ready' > \n Clear scope. \n </${tag}>`).reminder)
            .toEqual({ status: 'ready', summary: 'Clear scope.' });
    });

    it('accepts blank lines and up to three leading spaces outside code blocks', () => {
        expect(parseSafeguardReminder(`\n \n   ${ready}`).reminder)
            .toEqual({ status: 'ready', summary: 'No obvious issue found.' });
    });

    it('decodes the five named entities once into plain text', () => {
        expect(parseSafeguardReminder(`<${tag} status="ready">&amp; &lt; &gt; &quot; &apos; &amp;lt;</${tag}>`).reminder)
            .toEqual({ status: 'ready', summary: '& < > " \' &lt;' });
        expect(parseSafeguardReminder(`<${tag} status="revise"><quote>&lt;script&gt;&amp;&lt;/script&gt;</quote><suggestion>Use &quot;private&quot; &amp; &apos;local&apos;.</suggestion></${tag}>`).reminder)
            .toEqual({
                status: 'revise',
                issues: [{ quote: '<script>&</script>', suggestion: 'Use "private" & \'local\'.' }],
            });
    });

    it.each([ready, revise, `<${tag}\nstatus = 'ready' >Clear scope.</${tag}>`])(
        'preserves the content of every incomplete streaming prefix without emitting a card: %s',
        (complete) => {
            for (let length = 1; length < complete.length; length += 1) {
                for (const prefix of ['', ' \n']) {
                    const text = prefix + complete.slice(0, length);
                    const parsed = parseSafeguardReminder(text);
                    expect(parsed.reminder, `prefix length ${length}`).toBeNull();
                    expect(parsed.text.replace('&lt;', '<'), `prefix length ${length}`).toBe(text);
                }
            }
            expect(parseSafeguardReminder(complete).reminder).not.toBeNull();
        },
    );

    it.each([
        `<${tag}>Clear scope.</${tag}>`,
        `<${tag} status="unknown">Clear scope.</${tag}>`,
        `<${tag} status="Ready">Clear scope.</${tag}>`,
        `<${tag} status="ready"></${tag}>`,
        `<${tag} status="ready"> \n\t </${tag}>`,
        `<${tag} status=ready>Clear scope.</${tag}>`,
        `<${tag} status="ready'>Clear scope.</${tag}>`,
        `<${tag} status="ready" extra="yes">Clear scope.</${tag}>`,
        `<${tag} status="ready" status="revise">Clear scope.</${tag}>`,
        `<${tag} status="ready"><summary>Clear scope.</summary></${tag}>`,
        `<${tag} status="ready"><script>alert(1)</script></${tag}>`,
        `<${tag} status="ready"><${tag} status="ready">Nested</${tag}></${tag}>`,
        `<${tag} status="ready">A & B</${tag}>`,
        `<${tag} status="ready">&unknown;</${tag}>`,
        `<${tag} status="ready">&#32;</${tag}>`,
        `<${tag} status="revise"></${tag}>`,
        `<${tag} status="revise">An issue.</${tag}>`,
        `<${tag} status="revise"><quote>Target</quote></${tag}>`,
        `<${tag} status="revise"><suggestion>Choose one.</suggestion><quote>Target</quote></${tag}>`,
        `<${tag} status="revise"><quote> </quote><suggestion>Choose one.</suggestion></${tag}>`,
        `<${tag} status="revise"><quote>Target</quote><suggestion> </suggestion></${tag}>`,
        `<${tag} status="revise"><quote id="one">Target</quote><suggestion>Choose one.</suggestion></${tag}>`,
        `<${tag} status="revise"><quote><b>Target</b></quote><suggestion>Choose one.</suggestion></${tag}>`,
        `<${tag} status="revise"><quote>Target</quote>Other text<suggestion>Choose one.</suggestion></${tag}>`,
        `<${tag} status="revise"><quote>Target</quote><suggestion>Choose one.</suggestion><extra>More</extra></${tag}>`,
        `<${tag} status="unknown`,
        `<${tag} data=`,
    ])('keeps invalid structures literal without emitting a reminder: %s', (text) => {
        const parsed = parseSafeguardReminder(text);
        expect(parsed.reminder).toBeNull();
        expect(parsed.text.replace('&lt;', '<')).toBe(text);
    });

    it.each([
        '',
        ' \n\t ',
        'Normal **Markdown** with [a link](https://example.com).',
        `<not-a-reminder>Text</not-a-reminder>`,
        `<${tag}-example status="ready">Clear scope.</${tag}-example>`,
        '```xml\n' + ready + '\n```',
        '~~~xml\n' + ready + '\n~~~',
        '`' + ready + '`',
        '> ' + ready,
        '"' + ready + '"',
        '    ' + ready,
        '\t' + ready,
        '\n  \n    ' + ready,
        '\n\t\n\t' + ready,
        'An example:\n\n' + ready,
        'Please review ' + ready,
    ])('leaves ordinary, quoted, fenced, and non-leading content intact: %s', (text) => {
        expect(parseSafeguardReminder(text)).toEqual({ reminder: null, text });
    });

    it('preserves all trailing Markdown and options exactly', () => {
        const suffix = '\n\n**Scope**\n\n- Build it\n\n<options>\n<option>Approve</option>\n<option>Revise</option>\n</options>\n';
        expect(parseSafeguardReminder(ready + suffix).text).toBe(suffix);
        expect(parseSafeguardReminder(revise + suffix).text).toBe(suffix);
    });

    it.each(['', '</happyherd-safeguard-reminderr>'])(
        'preserves the plan and options when the closing tag is absent or malformed: %s',
        (ending) => {
            const text = `<${tag} status="ready">No obvious issues.${ending}\n\n**Plan**\n\n<options>\n<option>Approve</option>\n</options>`;
            const expected = { reminder: null, text: '&lt;' + text.slice(1) };
            expect(parseSafeguardReminder(text)).toEqual(expected);
            const reopened = JSON.parse(JSON.stringify({ text }));
            expect(parseSafeguardReminder(reopened.text)).toEqual(expected);
        },
    );

    it('escapes protocol HTML block starts while leaving ordinary Markdown and options intact', () => {
        const prefix = `<${tag} status="revise">\n\n<quote>Publish it</quote>\n<suggestion>Choose a destination.</suggestion>\n</${tag}r>`;
        const suffix = '\n**Plan**\n<options>\n<option>Approve</option>\n</options>';
        expect(parseSafeguardReminder(prefix + suffix)).toEqual({
            reminder: null,
            text: `&lt;${tag} status="revise">\n\n&lt;quote>Publish it</quote>\n&lt;suggestion>Choose a destination.</suggestion>\n&lt;/${tag}r>` + suffix,
        });
    });

    it.each(['```xml', '~~~~xml'])('preserves code examples after a malformed reminder: %s', (openingFence) => {
        const closingFence = openingFence.replace('xml', '');
        const prefix = `<${tag} status="ready">Still checking`;
        const suffix = `\n\n${openingFence}\n${ready}\n<quote>Example</quote>\n${closingFence}\n\n    ${ready}\n\nInline \`${ready}\` and [reference](https://example.com).`;
        expect(parseSafeguardReminder(prefix + suffix)).toEqual({ reminder: null, text: '&lt;' + prefix.slice(1) + suffix });
    });

    it('extracts only the first leading block', () => {
        expect(parseSafeguardReminder(ready + '\n' + revise)).toEqual({
            reminder: { status: 'ready', summary: 'No obvious issue found.' },
            text: '\n' + revise,
        });
    });

    it('reparses the persisted reply identically on reopen', () => {
        const persisted = JSON.parse(JSON.stringify({ text: revise + '\n\nPlease approve.' }));
        expect(parseSafeguardReminder(persisted.text)).toEqual(parseSafeguardReminder(revise + '\n\nPlease approve.'));
    });
});
