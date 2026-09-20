import { virtualModules as routeAdapters } from './routes.mocks.mjs';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createCapture, readFixtureModules, repoRoot, appRoot } from './common.mjs';

const require = createRequire(resolve(appRoot, 'package.json'));
const ts = require('typescript');
const output = resolve(repoRoot, 'docs/acceptance/issue-287/panels/workspace');
const fullSource = path => path;
const source = names => names.map(name => fullSource(name.includes('/') ? name : `components/${name}.tsx`));
const visualAdapters = ['@/constants/Typography', '@/theme', '@/components/StyledText', '@expo/vector-icons'];
const viewportVariants = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const themes = ['light', 'dark'];
const selected = new Set(process.argv.slice(2));
const existingManifest = existsSync(resolve(output, 'manifest.json')) ? JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8')) : [];
const allManifest = selected.size ? existingManifest.filter(row => !selected.has(row.captureSceneId ?? row.filename.split('/')[0])) : [];
const failures = [];
const connectMeasurements = [];
const connectRegressionDirectory = resolve(repoRoot,'docs/acceptance/issue-287/connect-input-regression');

function fixture(name) {
  const file = `sources/components/${name}.browser.test.ts`;
  const here = resolve(appRoot, 'sources/components');
  const directoryEntries = [
    { name: '.private', path: '/work/.private', type: 'directory' },
    ...Array.from({ length: 24 }, (_, i) => ({ name: `folder-${String(i).padStart(2, '0')}`, path: `/work/folder-${String(i).padStart(2, '0')}`, type: 'directory' })),
  ];
  const modules = readFixtureModules(file, {
    resolve, readFileSync, directoryEntries,
    newSessionProjectPath: '/work/project/extensions/browser-tools',
    octiconsFontPath: resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Octicons.ttf'),
    octiconsGlyphMapPath: resolve(appRoot, '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Octicons.json'),
  });
  for (const key of visualAdapters) delete modules[key];
  const original = readFileSync(resolve(appRoot, file), 'utf8');
  const ast = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true);
  let entrySource;
  function walk(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'stdin' && ts.isObjectLiteralExpression(node.initializer)) {
      const property = node.initializer.properties.find(value => value.name?.getText(ast) === 'contents');
      if (property && !entrySource) entrySource = new Function('appRoot', 'here', 'resolve', `return (${property.initializer.getText(ast)});`)(appRoot, here, resolve);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return { modules, entrySource, entryFile: entrySource ? undefined : `sources/components/__testdata__/${name}.browser.fixture.tsx`, origin: file };
}

function normalizeFixtureImports(modules) {
  return args => {
    if (args.path.startsWith('.') && args.importer.startsWith(resolve(appRoot, 'sources'))) {
      const key = '@/' + relative(resolve(appRoot, 'sources'), resolve(dirname(args.importer), args.path)).replace(/\.(?:tsx?|jsx?)$/, '');
      if (Object.hasOwn(modules, key)) return { path: key, namespace: 'kilv-mock' };
      if (key === '@/sync/apiSocket' && args.importer.endsWith('/sync/workspaceLive.ts') && modules[key]) return { path: key, namespace: 'kilv-mock' };
    }
    return undefined;
  };
}

const scenes = [];
const projects = fixture('projectsSuperSession');
scenes.push({
  id: 'sidebar-projects', label: 'Desktop navigation and project/session groups', fixture: projects,
  sourcePaths: source(['SidebarView', 'SidebarNavigationButton', 'FlatSessionRow']),
  params: { scenario: 'projects' }, ready: '[data-testid="desktop-sidebar"]',
  limitations: ['The surrounding avatar/provider identities and service state are synthetic; navigation, grouping and session rows are production components.'],
});
scenes.push({
  id: 'session-workspace-groups', label: 'Active session workspace groups', fixture: projects,
  sourcePaths: source(['ActiveSessionsGroupCompact', 'ProjectGroup']),
  params: { scenario: 'projects', grouping: 'project' }, ready: '[data-testid="desktop-sidebar"]',
  prepare: async page => { await page.getByRole('button', { name: /show archived/i }).last().click(); },
  limitations: ['Avatar/provider identities and account state are synthetic.'],
});
scenes.push({
  id: 'project-detail', label: 'Project detail and assigned sessions', fixture: projects,
  sourcePaths: source(['app/(app)/projects/[id].tsx', 'FlatSessionRow']),
  params: { scenario: 'projects', screen: 'detail', project: 'project-alpha' }, ready: '[data-testid="project-detail-screen"]',
});

const workspace = fixture('desktopWorkspace');
workspace.entrySource = readFileSync(resolve(appRoot, workspace.entryFile), 'utf8').replace("../../app/(app)/workspace", "@/app/(app)/workspace").replace("fileReviewSurface === 'mobile-source'", "(fileReviewSurface === 'mobile-source' || fileReviewSurface === 'desktop-source')");
workspace.entryFile = undefined;
for (const [id, surface, label] of [
  ['workspace-markdown', 'markdown', 'File workspace · Markdown preview'],
  ['workspace-source', 'source', 'File workspace · source and diff controls'],
]) scenes.push({
  id, label, fixture: workspace,
  sourcePaths: source(['DesktopFileWorkspace', 'FileViewPanel', ...(surface === 'markdown' ? ['components/markdown/MarkdownView.web.tsx'] : ['components/diff/PierreDiffView.tsx'])]),
  params: viewport => ({ 'file-review': `${viewport.width < 500 ? 'mobile' : 'desktop'}${surface === 'source' ? '-source' : ''}` }),
  ready: viewport => `[data-testid="file-review-${viewport.width < 500 ? 'mobile' : 'desktop'}"]`,
  prepare: async page => { if(surface==='markdown')await page.locator('.hh-markdown-root').filter({visible:true}).first().waitFor();else await page.locator('diffs-container').filter({visible:true}).first().waitFor(); },
  limitations: ['File contents and machine RPC results are synthetic. Capture shows the production file viewer; it is not a live workspace.'],
});
scenes.push({
  id: 'workspace-live', label: 'Localhost live preview workspace', fixture: workspace,
  sourcePaths: source(['DesktopFileWorkspace', 'components/LocalhostLiveView.web.tsx']),
  params: viewport => ({ 'localhost-live': viewport.width < 500 ? 'mobile' : 'desktop' }),
  ready: viewport => `[data-testid="localhost-live-${viewport.width < 500 ? 'mobile' : 'desktop'}"]`,
  prepare:async page=>{await page.getByRole('textbox',{name:'Open localhost URL',exact:true}).fill('http://localhost:3000/live');await page.getByRole('button',{name:'Open localhost URL',exact:true}).click();const target=page.frameLocator('iframe').getByRole('button',{name:'Live from machine-2'});await target.waitFor({timeout:15000});await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();if(!box||box.x<0||box.x+box.width>page.viewportSize().width)throw new Error('Live preview target remains outside the visible iframe viewport');},
  limitations: ['Live transport returns a synthetic local page; preview controls are production.'],
});
const link = fixture('WorkspaceLinkViewer');
scenes.push({
  id: 'workspace-link', label: 'Workspace file link and feedback composer', fixture: link,
  sourcePaths: source(['WorkspaceLinkViewer', 'WorkspaceFeedbackComposer', 'FileViewPanel', 'components/markdown/MarkdownView.web.tsx']),
  ready: '.hh-markdown-root',
  limitations: ['Linked machine, Markdown file and feedback transport are synthetic; no feedback is sent.'],
});
const sidechat = fixture('sideChatHeader');
scenes.push({
  id: 'new-session', label: 'New session · model, machine, workspace and prompt', fixture: sidechat,
  sourcePaths: source(['app/(app)/new/index.tsx']), ready: '[data-testid="full-new-session"]',
  init: () => { globalThis.__HAPPYHERD_FIXTURE_OPTIONS__ = { newSession: true, newSessionLayout: true, modelPicker: true }; },
  limitations: ['Synthetic model/machine capability state. No session is launched.'],
});
scenes.push({
  id: 'new-session-path', label: 'New session · machine folder picker', fixture: sidechat,
  sourcePaths: source(['app/(app)/new/index.tsx', 'MachinePathBrowser']), ready: '[data-testid="full-new-session"]',
  init: () => { globalThis.__HAPPYHERD_FIXTURE_OPTIONS__ = { newSession: true, newSessionLayout: true, modelPicker: true }; },
  prepare: async page => { await page.getByText('/work/project/extensions/browser-tools', { exact: true }).click(); await page.getByTestId('new-session-recent-path-list').waitFor(); },
  limitations: ['Directory listings and recent paths are synthetic.'],
});
scenes.push({
  id: 'home-dock', label: 'Home dock · start a session', fixture: sidechat,
  crop:'body',sourcePaths: source(['HomeDock']), ready: '[data-testid="home-dock"]',
  prepare:async page=>{await page.getByTestId('home-dock').getByText('Inspect attachments',{exact:true}).filter({visible:true}).click();await page.locator('textarea').filter({visible:true}).first().waitFor();},
  init: () => { globalThis.__HAPPYHERD_FIXTURE_OPTIONS__ = { homeDock: true, modelPicker: true }; },
});
const empty = fixture('EmptyMainScreen');
const english = `export {t,getCurrentLanguage,getLanguageNativeName,resolveSupportedLanguage} from '${resolve(appRoot,'sources/text/index.ts')}';`;
scenes.push({
  id: 'empty-onboarding', label: 'Empty sessions · terminal connection onboarding', fixture: empty,
  modules: { '@/text': english },
  sourcePaths: source(['SessionsListWrapper', 'EmptyMainScreen']), ready: '[data-testid="empty-main-onboarding"]',
  init: () => { globalThis.__PLATFORM__ = 'web'; globalThis.__MACHINES__ = []; globalThis.__DOCK__ = false; globalThis.__HAS_ARCHIVED__ = true; },
});
scenes.push({
  id: 'empty-tablet', label: 'No active sessions · connected machine', fixture: empty,
  modules: { '@/text': english },
  sourcePaths: source(['EmptySessionsTablet']), ready: '#empty-tablet',
  init: () => { globalThis.__MACHINES__ = [{ id: 'fixture-machine', name: 'Development Mac', online: true }]; },
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {EmptySessionsTablet} from '@/components/EmptySessionsTablet';createRoot(document.getElementById('root')).render(<div id="empty-tablet" style={{display:'flex',height:'100vh'}}><EmptySessionsTablet/></div>);`,
});
const landing = fixture('SignedOutLanding');
scenes.push({
  id: 'signed-out', label: 'Signed-out welcome and connect', fixture: landing,
  sourcePaths: source(['app/(app)/index.tsx']), ready: '[role="button"]',
  init: () => { globalThis.__LANDING_LOCALE__ = 'en'; },
});
scenes.push({
  id: 'code-editor', label: 'Source code editor', fixture: { modules: {}, origin: 'Production CodeEditor.web.tsx with synthetic source text' },
  sourcePaths: source(['components/CodeEditor.web.tsx']), ready: 'textarea.code-editor-textarea',
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {CodeEditor} from '@/components/CodeEditor.web';function App(){const[value,setValue]=React.useState('type CapturePanel = { id: string; theme: "light" | "dark" };\\n\\nexport const panel: CapturePanel = {\\n  id: "issue-287",\\n  theme: "dark",\\n};\\n');return <main style={{display:'flex',height:'100vh'}}><CodeEditor value={value} onChange={setValue} language="typescript" darkMode={new URLSearchParams(location.search).get('theme')==='dark'}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
});

const automation = {
  id: '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8', name: 'Weekly project review',
  schemaVersion:4, runtimeOwner: 'happyherd', machineId: 'machine-287', kind: 'scheduled', schedule: '0 9 * * 1', timezone: 'America/New_York',
  instruction: '## Weekly project review\n\n- Review open pull requests and failing checks.\n- Summarize changes to the workspace.\n- Suggest the next small, reviewable improvement.',
  rail: 'codex', workspace: '/workspace/happyherd', commanderId: null, status: 'active', maxRetries: 1,
  tags: ['Project Beacon', 'Maintenance'], createdAt: '2026-09-14T13:00:00.000Z', updatedAt: '2026-09-18T13:00:00.000Z',
  lastScheduledAt: '2026-09-14T13:00:00.000Z', lastRunAt: '2026-09-14T13:00:00.000Z',
};
const history = [{ id: 'run-287', automationId: automation.id, status: 'completed', attempt: 1, scheduledFor: '2026-09-14T13:00:00.000Z', startedAt: '2026-09-14T13:00:02.000Z', completedAt: '2026-09-14T13:02:12.000Z', sessionId: 'weekly-review-session' }];
const automationModules = {
  '@/text': english,
  '@react-navigation/native': `import React from 'react';export const useFocusEffect=effect=>React.useEffect(effect,[effect]);`,
  'expo-router': `export const Stack={Screen:()=>null};export const useRouter=()=>({push(){},navigate(){}});`,
  '@/sync/storage': `const machines=[{id:'machine-287',active:true,activeAt:Date.now(),metadataVersion:1,daemonStateVersion:1,metadata:{displayName:'Development Mac',homeDir:'/workspace'},daemonState:{status:'running'}}];export const useAllMachines=()=>machines;export const useSession=()=>null;`,
  '@/utils/machineUtils': `export const isMachineOnline=()=>true;`,
  '@/hooks/useNavigateToSession': `export const useNavigateToSession=()=>()=>{};`,
  '@/utils/automationProfiling': `export const automationProfileStart=()=>0;export const profileAutomationRpc=(_name,fn)=>fn();export const recordAutomationProfile=()=>{};`,
  '@/sync/ops': `export const machineReadFileWithinRoot=async()=>({success:false});export const machineListAutomations=async()=>({definitionSchemaVersion:4,automations:${JSON.stringify([automation,{...automation,id:'9f0a5dd0-b7c0-4b60-a747-675b49ccfdc8',name:'Dependency check',status:'paused',schedule:'0 18 * * 5'}])}});export const machineAutomationHistory=async()=>({runs:${JSON.stringify(history)}});export const machineListCommanders=async()=>({commanders:[]});export const machineCreateAutomation=async()=>{};export const machineUpdateAutomation=async()=>{};export const machinePauseAutomation=async()=>{};export const machineResumeAutomation=async()=>{};export const machineRunAutomationNow=async()=>{};export const machineDeleteAutomation=async()=>{};`,
};
scenes.push({
  id: 'automations-list', label: 'Automations · scheduled and paused tasks', fixture: link, modules: automationModules,
  sourcePaths: source(['app/(app)/automations/index.tsx']), ready: '[placeholder="Search automations"]',
  prepare: async page => { await page.getByText('Weekly project review', { exact: true }).waitFor(); },
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import Screen from '@/app/(app)/automations/index';createRoot(document.getElementById('root')).render(<Screen/>);`,
});
scenes.push({
  id:'automation-create',label:'Automation · create a scheduled job',fixture:link,modules:automationModules,
  sourcePaths:source(['app/(app)/automations/index.tsx']),ready:'[placeholder="Search automations"]',
  prepare:async page=>{await page.getByText('Weekly project review',{exact:true}).waitFor();await page.getByText('New',{exact:true}).click();await page.getByText('New automation',{exact:true}).waitFor();},
  entrySource:`import React from'react';import{createRoot}from'react-dom/client';import Screen from'@/app/(app)/automations/index';createRoot(document.getElementById('root')).render(<Screen/>);`,
  limitations:['Synthetic machine capabilities; the create form is displayed without saving a definition.','First viewport of the form; Project tags and Save automation may continue below the fold. See automation-create-bottom for the scrolled footer.'],
  changeDescription:'Automation form fields, scheduling controls and footer actions adopt KILV surfaces and typography.',
});
const automationCreateScene=scenes.find(scene=>scene.id==='automation-create');
scenes.push({
  ...automationCreateScene,id:'automation-create-bottom',capturePanelId:'automation-create',label:automationCreateScene.label,state:'scrolled-bottom',
  prepare:async(page,viewport)=>{
    await automationCreateScene.prepare(page);
    await page.mouse.move(viewport.width-35,viewport.height-120);
    await page.mouse.wheel(0,2400);
    const save=page.getByText('Save automation',{exact:true});
    await save.scrollIntoViewIfNeeded();
    const box=await save.boundingBox();
    if(!box||box.y<0||box.y+box.height>viewport.height)throw new Error('Save automation remains outside the visible viewport after scrolling');
  },
  limitations:['Synthetic machine capabilities; the actual form is scrolled to the Save automation control. No definition is submitted.','Complements the retained automation-create first viewport; this is visual reachability evidence, not a persisted creation journey.'],
});
scenes.push({
  id: 'automation-detail', label: 'Automation · instruction, schedule and history', fixture: link, modules: automationModules,
  sourcePaths: source(['HappyHerdAutomationDetail']), ready: '[data-testid="automation-detail-header"]',
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {HappyHerdAutomationDetail} from '@/components/HappyHerdAutomationDetail';const noop=()=>{};createRoot(document.getElementById('root')).render(<div style={{display:'flex',height:'100vh',justifyContent:'center'}}><HappyHerdAutomationDetail automation={${JSON.stringify(automation)}} machineName="Development Mac" history={${JSON.stringify(history)}} historyLoading={false} historyFailed={false} mobile={innerWidth<500} onBack={noop} onClose={noop} onRunNow={noop} onEdit={noop} onToggleStatus={noop} onDelete={noop} onOpenSession={noop} onRetryHistory={noop}/></div>);`,
});
scenes.push({
  id: 'automation-card', label: 'Automation card · expanded actions and history', fixture: link, modules: automationModules,
  sourcePaths: source(['HappyHerdAutomationCard']), ready: '#automation-card',
  prepare: async page => { await page.getByText('Weekly project review',{exact:true}).click();await page.getByText('0 9 * * 1 · America/New_York',{exact:true}).waitFor(); },
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {HappyHerdAutomationCard} from '@/components/HappyHerdAutomationCard';const noop=()=>{};createRoot(document.getElementById('root')).render(<div id="automation-card" style={{width:'min(100%,800px)',padding:16,boxSizing:'border-box',margin:'24px auto'}}><HappyHerdAutomationCard automation={${JSON.stringify(automation)}} history={${JSON.stringify(history)}} onToggleStatus={noop} onRunNow={noop} onToggleHistory={noop} onOpenSession={noop} onEdit={noop} onDelete={noop}/></div>);`,
});
scenes.push({
  id: 'command-palette', label: 'Command palette · navigation and session actions', fixture: sidechat,
  modules: { '@/text': english },
  sourcePaths: source(['components/CommandPalette/CommandPalette.tsx', 'components/CommandPalette/CommandPaletteInput.tsx', 'components/CommandPalette/CommandPaletteItem.tsx', 'components/CommandPalette/CommandPaletteResults.tsx', 'components/CommandPalette/CommandPaletteModal.tsx']),
  ready: 'input', crop: 'body',
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {CommandPalette} from '@/components/CommandPalette/CommandPalette';import {CommandPaletteModal} from '@/components/CommandPalette/CommandPaletteModal';const commands=[{id:'workspace',title:'Open workspace',subtitle:'Browse files and review changes',icon:'folder-outline',category:'Navigation',shortcut:'⌘1',action(){}},{id:'projects',title:'Open projects',subtitle:'View connected project sessions',icon:'albums-outline',category:'Navigation',shortcut:'⌘2',action(){}},{id:'new',title:'New session',subtitle:'Start an agent in a workspace',icon:'add',category:'Sessions',shortcut:'⌘N',action(){}}];createRoot(document.getElementById('root')).render(<CommandPaletteModal visible onClose={()=>{}}><CommandPalette commands={commands} onClose={()=>{}}/></CommandPaletteModal>);`,
});
scenes.push({
  id: 'duplicate-session', label: 'Duplicate session · choose a rewind point', fixture: sidechat,
  removeModules: ['@/components/DuplicateSheet', '@/utils/sessionFork'],
  modules: {
    '@/text': english,
    '@/sync/storage': `export const useSession=()=>({id:'copy-session',metadata:{flavor:'codex',machineId:'machine-287',path:'/workspace/happyherd',codexThreadId:'thread-287'}});`,
    '@/sync/ops': `export const codexListRewindPoints=async()=>({type:'success',points:[{itemId:'first',text:'Inspect the current project and explain its main modules.',timestamp:1789822800000},{itemId:'second',text:'Add a focused regression test for the restore form.',timestamp:1789823100000}]});export const claudeListRewindPoints=codexListRewindPoints;export const forkAndSpawn=async()=>({type:'success',sessionId:'synthetic'});`,
    '@/hooks/useHappyAction': `import React from 'react';export const useHappyAction=fn=>[false,React.useCallback(fn,[fn])];`,
  },
  sourcePaths: source(['DuplicateSheet']), ready: '#root',
  prepare: async page => { await page.getByText('Add a focused regression test for the restore form.', { exact: true }).waitFor(); },
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {DuplicateSheet} from '@/components/DuplicateSheet';createRoot(document.getElementById('root')).render(<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><DuplicateSheet sessionId="copy-session" onClose={()=>{}}/></div>);`,
});
scenes.push({
  id: 'git-status', label: 'Project and session Git status indicators', fixture: link,
  modules: { '@/text': english, '@/sync/storage': `export const useSessionGitStatus=()=>({branch:'feat/issue-287-kilv-ui',lastUpdatedAt:1,isDirty:true,modifiedCount:3,untrackedCount:1,stagedCount:2,unstagedLinesAdded:128,unstagedLinesRemoved:42});` },
  sourcePaths: source(['ProjectGitStatus', 'CompactGitStatus', 'GitStatusBadge']), ready: '#git-status',
  entrySource: `import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectGitStatus} from '@/components/ProjectGitStatus';import {CompactGitStatus} from '@/components/CompactGitStatus';import {GitStatusBadge} from '@/components/GitStatusBadge';createRoot(document.getElementById('root')).render(<section id="git-status" style={{padding:32,display:'flex',flexDirection:'column',gap:24}}><div><h3>Project changes</h3><ProjectGitStatus sessionId="fixture"/></div><div><h3>Compact changes</h3><CompactGitStatus sessionId="fixture"/></div><div><h3>Session changes</h3><GitStatusBadge sessionId="fixture"/></div></section>);`,
  limitations: ['The section headings are capture-only labels; all three Git indicators are production components with synthetic counts.'],
});


// These panel-only entries import the visual owner directly and keep only its
// synthetic service boundary. They do not change the production route graph.
scenes.push({
  id:'connect-terminal',label:'Connect terminal · paste authentication URL',fixture:empty,
  modules:{'@/track':`export const trackConnectAttempt=()=>{};`},
  sourcePaths:source(['ConnectButton']),ready:'input',
  limitations:['The Authenticate Terminal title remains ellipsized in its fixed 210 px container; a rendered comparison against baseline 189c504b confirmed that title truncation predates this redesign. The manual URL input overflow introduced by the 16 px mono typography is fixed with minWidth:0. Each capture asserts the input and confirmation control remain within the card while retaining 16 px JetBrains Mono.'],
  prepare:async(page,viewport)=>{
    await page.locator('input').fill('happy://terminal?publicKey=synthetic-preview');
    const measurement=await page.locator('input').evaluate(input=>{
      const row=input.parentElement;
      const card=row.parentElement;
      const confirmationButton=row.children[1];
      const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      const font=getComputedStyle(input);
      return{value:input.value,card:rect(card),input:rect(input),confirmationButton:rect(confirmationButton),fontSize:font.fontSize,fontFamily:font.fontFamily,minWidth:font.minWidth};
    });
    if(measurement.value!=='happy://terminal?publicKey=synthetic-preview')throw new Error('Terminal URL draft changed while resizing: '+JSON.stringify(measurement));
    const fits=(inner,outer)=>inner.left>=outer.left-.5&&inner.right<=outer.right+.5&&inner.top>=outer.top-.5&&inner.bottom<=outer.bottom+.5;
    if(!fits(measurement.input,measurement.card)||!fits(measurement.confirmationButton,measurement.card))throw new Error('Terminal URL input or confirmation button exceeds its card: '+JSON.stringify(measurement));
    if(measurement.fontSize!=='16px'||!measurement.fontFamily.includes('JetBrainsMono'))throw new Error('Terminal URL input lost 16px mono typography: '+JSON.stringify(measurement));
    connectMeasurements.push({theme:new URL(page.url()).searchParams.get('theme'),viewport,...measurement,inputFits:true,confirmationFits:true,draftPreserved:true});
  },
  beforeReady:async page=>{await page.getByText('Authenticate Terminal with URL paste',{exact:true}).click();},
  entrySource:`import React from 'react';import{createRoot}from'react-dom/client';import{ConnectButton}from'@/components/ConnectButton';createRoot(document.getElementById('root')).render(<div style={{display:'flex',padding:32,justifyContent:'center'}}><ConnectButton/></div>);`,
});
scenes.push({
  id:'inline-comment-review',label:'Inline file review · pinned comment and draft',fixture:link,
  sourcePaths:source(['components/InlineCommentReview.web.tsx']),ready:'[data-testid="inline-comment-thread:line:3"]',
  prepare:async page=>{await page.getByLabel('Write a comment…').fill('Explain why this fallback preserves the original session.');},
  entrySource:`import React from'react';import{createRoot}from'react-dom/client';import{InlineCommentReview,InlineCommentThread}from'@/components/InlineCommentReview.web';function App(){const[comments,setComments]=React.useState([{id:'first',line:3,feedback:'Keep the existing workspace path when reconnecting.'}]);const[anchor,setAnchor]=React.useState({line:3});const props={comments,onCommentsChange:setComments,activeAnchor:anchor,onActiveAnchorChange:setAnchor};return <div style={{maxWidth:780,padding:16,margin:'40px auto',width:'100%',boxSizing:'border-box'}}><InlineCommentThread {...props} anchor={{line:3}}/><InlineCommentReview {...props} originSessionId="linked-session" reference={{machineId:'linked-machine',absolutePath:'/workspace/review.ts',kind:'file'}} mode="bar"/></div>};createRoot(document.getElementById('root')).render(<App/>);`,
});
scenes.push({
  id:'files-sidebar',label:'Files sidebar · changes, workspace and side-chat actions',fixture:workspace,
  sourcePaths:source(['FilesSidebar']),ready:'[data-testid="production-files-sidebar"]',crop:'[data-testid="production-files-sidebar"]',
  entrySource:workspace.entrySource.replace(/createRoot\(document\.getElementById\('root'\)!\)\.render\([\s\S]*$/,`createRoot(document.getElementById('root')!).render(<ProductionDesktopWorkspaceEntryPointsDemo/>);`),
  limitations:['The isolated sidebar is 280 px wide at both browser sizes, matching its production desktop slot.'],
});
const navigationModules={
  'react-native-reanimated':routeAdapters['react-native-reanimated']+`export const useReducedMotion=()=>false;`,
  'react-native-worklets':routeAdapters['react-native-worklets'],
  'react-native-gesture-handler':`export {ScrollView}from'react-native';export const Swipeable=({children})=>children;const chain=new Proxy(function(){},{get:()=>chain,apply:()=>chain});export const Gesture={Pan:()=>chain,Tap:()=>chain,LongPress:()=>chain,Race:()=>chain,Simultaneous:()=>chain};export const GestureDetector=({children})=>children;`,
  '@/hooks/useInboxHasContent':`export const useInboxHasContent=()=>true;`,
  '@/utils/responsive':`export const useHeaderHeight=()=>64;export const useIsTablet=()=>innerWidth>=768;export const getDeviceType=()=>innerWidth>=768?'tablet':'phone';`,
};
scenes.push({
  id:'navigation-bars',label:'Navigation · header, tab bar and new-session action',fixture:projects,
  modules:navigationModules,removeModules:['@/components/TabBar','@/components/navigation/Header'],
  sourcePaths:source(['components/navigation/Header.tsx','TabBar','FABWide']),ready:'#navigation-bars',
  entrySource:`import React from'react';import{createRoot}from'react-dom/client';import{View,Pressable}from'react-native';import{Ionicons}from'@expo/vector-icons';import{useUnistyles}from'react-native-unistyles';import{Header}from'@/components/navigation/Header';import{TabBar}from'@/components/TabBar';import{FABWide}from'@/components/FABWide';function App(){const{theme}=useUnistyles();const[tab,setTab]=React.useState('sessions');return <div id="navigation-bars" style={{height:'100vh',display:'flex',flexDirection:'column'}}><Header title="Happy" subtitle="Project Beacon" headerLeft={()=> <Ionicons name="menu" size={24} color={theme.colors.text}/>} headerRight={()=> <Ionicons name="search" size={22} color={theme.colors.text}/>}/><View style={{flex:1}}><FABWide onPress={()=>{}}/></View><TabBar activeTab={tab} onTabPress={setTab} inboxBadgeCount={2}/></div>};createRoot(document.getElementById('root')).render(<App/>);`,
  limitations:['The panel arranges production navigation components in an isolated browser frame; native gesture animation and glass effects are not exercised.'],
});
scenes.push({
  id:'main-view',label:'Home main view · sessions and navigation',fixture:projects,
  modules:navigationModules,removeModules:['@/components/TabBar','@/components/navigation/Header'],
  sourcePaths:source(['MainView']),params:{scenario:'projects',mobile:'1'},ready:'#root',
  entrySource:`import React from'react';import{createRoot}from'react-dom/client';import{MainView}from'@/components/MainView';createRoot(document.getElementById('root')).render(<div style={{display:'flex',flexDirection:'column',height:'100vh',width:innerWidth<500?'100%':390}}><MainView variant={innerWidth<500?'phone':'sidebar'}/></div>);`,
  limitations:['Desktop uses the production sidebar variant and 390 px uses the phone variant. Synthetic sessions; HomeDock and inactive settings/inbox destinations are outside this fixture, each captured separately.'],
});
scenes.push({
  id:'side-chat-panel',label:'Side chat panel · start a delegated conversation',fixture:sidechat,
  sourcePaths:source(['SideChatPanel']),ready:'#side-chat-panel',
  entrySource:`import React from'react';import{createRoot}from'react-dom/client';import{SideChatPanel}from'@/components/SideChatPanel';createRoot(document.getElementById('root')).render(<div id="side-chat-panel" style={{height:'100vh',display:'flex',maxWidth:700,margin:'auto'}}><SideChatPanel sideChats={[]} activeSideChatId={null} onSelectSideChat={()=>{}} onCloseSideChat={()=>{}} creatingSideChat={false} canCreateSideChat onCreateSideChat={async()=>false}/></div>);`,
  state:'empty',limitations:['Empty side chat state; this capture does not contain an active delegated session.'],
});

const changeDescriptions = {
 'sidebar-projects':'Sidebar actions and session rows use KILV surfaces, compact geometry and Space Grotesk typography.',
 'session-workspace-groups':'Workspace and project groups use semantic borders, status tones and compact session row spacing.',
 'project-detail':'Project detail actions, grouped session cards and mono workspace metadata inherit KILV tokens.',
 'workspace-markdown':'File tabs, review toolbar and Markdown source-line controls share KILV surfaces and mono labels.',
 'workspace-source':'Source review uses the KILV surrounding toolbar and tokenized syntax/line-review surfaces.',
 'workspace-live':'Live preview controls inherit the workspace material and typography while retaining real iframe behavior.',
 'workspace-link':'Linked-file chrome and feedback composer use KILV input, action and border tokens.',
 'new-session':'New-session machine, provider and prompt controls adopt the KILV palette and compact spacing.',
 'new-session-path':'Machine path browser uses semantic selection surfaces, compact folder rows and mono paths.',
 'home-dock':'Home composer and machine/model pickers adopt the KILV palette, mono metadata and flatter geometry.',
 'empty-onboarding':'Empty-session onboarding uses the KILV artwork, typography and terminal command surface.',
 'empty-tablet':'Empty connected-machine state uses the KILV icon, action contrast and typography.',
 'signed-out':'Welcome artwork, headline and connect/restore controls use the KILV visual system.',
 'code-editor':'Source editor uses KILV foreground/background tokens and JetBrains Mono.',
 'automations-list':'Automation navigation, filters and list items use semantic KILV surfaces and dense rows.',
 'automation-detail':'Automation details, instruction preview and schedule sections use KILV borders and typography.',
 'automation-card':'Expanded automation cards use KILV surfaces, status dots, tags and action colors.',
 'command-palette':'Command search, selected rows and shortcut hints use KILV palette, corners and type.',
 'duplicate-session':'Rewind selection sheet uses semantic KILV surfaces, selected rows and action colors.',
 'git-status':'Git indicators preserve added/removed meaning while adopting KILV palette and mono counts.',
 'connect-terminal':'Terminal connect actions and URL input adopt KILV surfaces, borders and typography.',
 'inline-comment-review':'Pinned comment cards use KILV seams, border glow, mono labels and input/action tones.',
 'files-sidebar':'Files sidebar sections and file actions use KILV borders, typography and compact geometry.',
 'navigation-bars':'Header, tab selection and new-session action use the shared KILV surfaces and typography.',
 'main-view':'Main view chrome and session layout inherit the KILV background and navigation tokens.',
 'side-chat-panel':'Side chat empty state uses KILV typography and correctly contrasted primary actions.',
};

const surroundingRendererKeys=['@/components/Avatar','@/components/AvatarBrutalist','@/components/AvatarSkia','@/components/AvatarGradient','@/components/CommanderSessionAvatar','@/components/SessionStatusAvatar','@/components/ProviderIcon','@/components/HarnessBadgeIcon','@/components/StatusDot'];
function rendererLimitations(modules){
 const replaced=surroundingRendererKeys.filter(key=>Object.hasOwn(modules,key));
 return replaced.length?[`Surrounding visual renderer replacements supplied by the fixture: ${replaced.map(key=>key.replace('@/components/','')).join(', ')}. These renderers are outside the claimed source owners and are not visual evidence for their production appearance; target owners, Typography and Expo vector icon glyphs remain real.`]:[];
}

async function runScene(scene) {
  if (selected.size && !selected.has(scene.id)) return;
  let capture;
  const directory = resolve(output, scene.id);
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'manifest.json'),'[]\n');
  try {
    const modules = { ...scene.fixture.modules, '@/text': english, ...scene.modules };
    delete modules['@/components/FileIcon'];
    delete modules['react-native-svg'];
    modules['expo-localization']=`export const getLocales=()=>[{languageTag:'en-US'}];`;
    modules['@/sync/persistence']=(modules['@/sync/persistence']??'')+(modules['@/sync/persistence']?.includes('export const loadSettings')?'':`export const loadSettings=()=>({settings:{preferredLanguage:'en'}});`);
    if(modules['@/sync/rig']&&!modules['@/sync/rig'].includes('qualifyRigModelKey'))modules['@/sync/rig']+=`export const qualifyRigModelKey=(rig,model)=>rig+':'+model;`;
    for (const key of visualAdapters) delete modules[key];
    for (const key of scene.removeModules ?? []) delete modules[key];
    capture = await createCapture({
      group: `workspace-${scene.id}`, outDir: directory,
      entrySource: scene.entrySource ?? scene.fixture.entrySource,
      entryFile: scene.entrySource ? undefined : scene.fixture.entryFile,
      virtualModules: modules, onResolve: normalizeFixtureImports(modules),
      css: 'html,body,#root{height:100%;}#root{display:flex;flex-direction:column;min-width:0;}',
    });
    for (const theme of themes) for (const viewport of viewportVariants) {
      let page;const pageErrors=[];
      try {
        const params = typeof scene.params === 'function' ? scene.params(viewport) : scene.params;
        page = await capture.open({ theme, viewport, params, init: scene.init });
        page.on('pageerror',error=>pageErrors.push(error.message));
        page.setDefaultTimeout(10000);
        if(scene.beforeReady) await scene.beforeReady(page,viewport);
        const ready = typeof scene.ready === 'function' ? scene.ready(viewport) : scene.ready;
        await page.locator(ready).first().waitFor({ state: 'visible' });
        if (scene.prepare) await scene.prepare(page, viewport);
        const row = await capture.capture(page, {
          panelId: scene.capturePanelId ?? scene.id, label: scene.label, sourcePaths: scene.sourcePaths, captureSceneId: scene.id,
          state: scene.state ?? 'representative', theme, viewport,
          locator: scene.crop ? page.locator(scene.crop).first() : undefined,
          limitations: [...(scene.limitations ?? []),...rendererLimitations(modules)], fixtureSource: scene.fixture.origin, changeDescription: scene.changeDescription ?? changeDescriptions[scene.id],
        });
        allManifest.push({...row,filename:`${scene.id}/${row.filename}`,environment:`${scene.id}/${row.environment}`});
        console.log(`CAPTURE ${scene.id} ${theme} ${viewport.width}`);
      } catch (error) {
        failures.push({ panelId: scene.id, theme, viewport, error: String(error), sourcePaths: scene.sourcePaths, bodyText: await page?.locator('body').innerText().catch(()=>''), pageErrors });
        console.error(`FAILED ${scene.id} ${theme} ${viewport.width}: ${error}`);
      } finally { await page?.close(); }
    }
  } catch (error) {
    failures.push({ panelId: scene.id, phase: 'bundle', error: String(error), sourcePaths: scene.sourcePaths });
    console.error(`BUNDLE FAILED ${scene.id}: ${error}`);
  } finally { await capture?.close();writeFileSync(resolve(directory,'failures.json'),JSON.stringify(failures.filter(row=>row.panelId===scene.id),null,2)+'\n'); }
}

mkdirSync(output, { recursive: true });
for (const scene of scenes) await runScene(scene);
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(allManifest, null, 2) + '\n');
writeFileSync(resolve(output, 'failures.json'), JSON.stringify(failures, null, 2) + '\n');
if(connectMeasurements.length===4&&!failures.some(row=>row.panelId==='connect-terminal')){
 const environment=JSON.parse(readFileSync(resolve(output,'connect-terminal/environment-workspace-connect-terminal.json'),'utf8'));
 mkdirSync(connectRegressionDirectory,{recursive:true});
 copyFileSync(resolve(output,'connect-terminal/connect-terminal-representative-light-390.png'),resolve(connectRegressionDirectory,'after-light-390.png'));
 writeFileSync(resolve(connectRegressionDirectory,'after-measurements.json'),JSON.stringify({sourceRevision:environment.sourceRevision,evidenceType:'component-fixture',measurements:connectMeasurements},null,2)+'\n');
}
console.log(JSON.stringify({ captures: allManifest.length, failures: failures.length }));
