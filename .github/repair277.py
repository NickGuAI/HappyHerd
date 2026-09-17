from pathlib import Path
import json
r = Path.cwd()
a = r / 'server/packages/happy-app/sources'
def edit(p, old, new, count=1):
    s = p.read_text()
    assert s.count(old) == count, (str(p), s.count(old), old[:100])
    p.write_text(s.replace(old, new))
edit(a/'app/(app)/_layout.tsx', "import { createPlainHeader } from '@/components/navigation/Header';\n", '')
edit(a/'app/(app)/new/index.tsx', "{agentType === 'rig' ? t('upstreamSync.agentOffline') : t('upstreamSync.cliOffline')}", "{selectedAgent === 'rig' ? t('upstreamSync.agentOffline') : t('upstreamSync.cliOffline')}", 2)
edit(a/'components/ChatList.tsx', 'if (!currentTurnComplete && currentTurnUserMessageId !== null)', 'if (!collapseCurrentTurn && currentTurnUserMessageId !== null)')
edit(a/'components/HappyAgentDiffView.tsx', 'total: git.changedFiles', 'total: String(git.changedFiles)')
edit(a/'components/tools/ToolFullView.tsx', 'getToolDisplayTitle, getToolSummaryCategory, isTerminalToolName', 'getToolDisplayTitle, getToolSummaryCategory, getTerminalToolCommand, isTerminalToolName')
edit(a/'components/tools/ToolFullView.tsx', "import { CodeView } from '../CodeView';", "import { CodeView } from '../CodeView';\nimport { CommandView } from '../CommandView';")
p = a/'components/tools/views/CodexPatchView.tsx'
s = p.read_text(); needle = "import { t } from '@/text';\n"
assert s.count(needle) == 2
p.write_text(s.replace(needle, '', 1))
edit(p, '    getPatchKindType,', '    getPatchKindType,\n    getPatchKindLabel,')
edit(p, '                        accessibilityRole="button"\n', '')
p = a/'sync/storage.ts'
edit(p, "        id: session.id,\n        botId: session.metadata?.bot?.id ?? null,\n        botUsername: session.metadata?.bot?.username ?? null,", '        id: session.id,')
edit(p, '    const personalProjectSessions: Session[] = [];\n    const botSessions: Session[] = [];', '    const personalProjectSessions: Session[] = [];')
p = a/'utils/toolDisplay.ts'
edit(p, "export function getToolDisplayTitle(tool: Pick<ToolCall, 'name' | 'title'>): string {\n    return tool.title?.trim() || tool.name;\n}\n\n", '')
edit(p, '    const action = getToolDisplayTitle(tool);', "    const action = happyToolDisplay[tool.name]?.title\n        || getToolActivityAction(getToolSummaryCategory(tool.name), tool.name);")
edit(p, "    return tool.title?.trim() || happyToolDisplay[tool.name]?.title\n        || getToolActivityAction(getToolSummaryCategory(tool.name), tool.name);", "    // Known Happy tools retain their approved labels; an unfamiliar provider\n    // name is data, not a title to rename. Activity rows format actions separately.\n    return tool.title?.trim() || happyToolDisplay[tool.name]?.title || tool.name;")
edit(a/'utils/toolDisplay.test.ts', '    getTerminalToolCommand,\n    getToolDisplayTitle,', '    getTerminalToolCommand,')
p = a/'utils/flatSessionList.test.ts'
edit(p, '], { sortByActivity: true });', ']);', 2)
edit(p, "id: 'laptop-bot', name:", "id: 'laptop-bot', lastActivityAt: 200, name:")
edit(p, "id: 'desktop-bot', name:", "id: 'desktop-bot', lastActivityAt: 100, name:")
for p in [a/'utils/flatSessionList.test.ts', a/'sync/agentSessionPlaces.spec.ts']:
    p.write_text(p.read_text().replace('/home/steve/', '/home/user/'))
p = a/'components/sessionPresentation.test.ts'
s = p.read_text(); start = s.index("describe('chat header', () => {"); end = s.index("describe('session details',", start)
s = s[:start] + '''describe('chat header', () => {
    it.each(['ios', 'android', 'web'])('retains folder and title without moving composer counts into the header on %s', (platform) => {
        state.platform = platform;
        const renderer = render(React.createElement(ChatHeaderView, {
            title: 'Session title', folderName: 'nice',
        }));
        expect(texts(renderer)).toEqual(platform === 'web'
            ? ['nice', '/', 'Session title']
            : ['Session title', 'nice']);
        expect(texts(renderer).some(text => /^[+\\-]\\d/.test(text))).toBe(false);
    });

    it('does not repeat a folder that already names the session', () => {
        expect(texts(render(React.createElement(ChatHeaderView, { title: 'nice', folderName: 'nice' })))).toEqual(['nice']);
    });

    it('keeps file overlays visible with the retained folder contract', () => {
        expect(texts(render(React.createElement(ChatHeaderView, { title: 'Session' })))).toEqual(['Session']);
        expect(texts(render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'nice', extraPathSegment: 'src/app.ts',
        })))).toEqual(['Session', 'nice', '•', 'src/app.ts']);
    });

    it('reconciles changed folder identity without retaining the previous subtitle', () => {
        const renderer = render(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'nice',
        }));
        expect(texts(renderer)).toEqual(['Session', 'nice']);
        act(() => renderer.update(React.createElement(ChatHeaderView, {
            title: 'Session', folderName: 'other',
        })));
        expect(texts(renderer)).toEqual(['Session', 'other']);
    });
});

''' + s[end:]
s = s.replace("    it('keeps the same font in the chat subtitle', () => {", "    it('keeps the shared count font when an overlay supplies a header right slot', () => {")
s = s.replace("title: 'Session', subtitle: 'main', gitChanges: changes,", "title: 'Session', folderName: 'main', rightSlot: React.createElement(GitLineChanges, { changes }),")
s = s.replace('    useSessionGitStatusFiles: () => null,', '    useSessionGitStatusFiles: () => null,\n    useLocalSetting: () => false,')
p.write_text(s)
p = a/'components/diff/DiffHeaderRight.tsx'
edit(p, "{style === 'unified' ? 'Unified' : 'Split'}", "{style === 'unified' ? t('diff.unified') : t('diff.split')}")
for locale, values in {'en': {'unified': 'Unified', 'split': 'Split'}, 'cn': {'unified': '统一视图', 'split': '并排视图'}, 'de': {'unified': 'Vereint', 'split': 'Geteilt'}}.items():
    p = a/f'text/locales/{locale}.json'; data = json.loads(p.read_text())
    assert not any(k in data['diff'] for k in values)
    data['diff'].update(values)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print('Applied bounded compiler and retained-presentation repairs.')
