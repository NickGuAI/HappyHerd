// Rendered evidence for the overhauled secondary pages (UI overhaul).
// Run: node scripts/kilv-capture/pages.capture.mjs [comma-separated scene IDs] [--out <dir>]
// Every page is a real production import rendered through React Native Web.
// Service and state boundaries are synthetic; each scene performs one real
// gesture on the visible control before capturing the resulting state.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createCapture, baseVirtualModules, appRoot, repoRoot } from './common.mjs';
import { virtualModules as routeAdapters } from './routes.mocks.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : resolve(repoRoot, '.artifacts/kilv-capture/pages');
const selected = args.find((arg, index) => !arg.startsWith('--') && (outIndex < 0 || index !== outIndex + 1))?.split(',');

// Render `_web` CSS (glows, selection rings, backdrop blur) like Unistyles does on
// Web; `_classNames` motion is not applied because screenshots disable animation.
const webMerge = `function webMerge(v){if(!v||typeof v!=='object'||Array.isArray(v)||!v._web)return v;const {_web,...rest}=v;const extra={};for(const [k,x] of Object.entries(_web))if(!k.startsWith('_'))extra[k]=x;return {...rest,...extra};}\n`;
baseVirtualModules['react-native-unistyles'] = webMerge + baseVirtualModules['react-native-unistyles']
    .replace('styles[key]=(...args)=>responsive(value(...args));', 'styles[key]=(...args)=>webMerge(responsive(value(...args)));')
    .replace('styles[key]=responsive(next);', 'styles[key]=webMerge(responsive(next));');

const modules = { ...routeAdapters };
const now = 1_790_000_000_000;

modules['expo-router'] = `import React from 'react';
const go=route=>window.__FIXTURE_NAVIGATE__?.(typeof route==='string'?route:route.pathname+(route.params?'?'+new URLSearchParams(route.params):''));
const router={push:go,navigate:go,replace:go,back(){},setParams(){},dismissTo:go,canGoBack:()=>true};
export const useRouter=()=>router;export {router};
export const useLocalSearchParams=()=>({id:'fixture-id'});export const useGlobalSearchParams=useLocalSearchParams;
export const usePathname=()=>'/';export const useNavigation=()=>({setOptions(){},addListener:()=>()=>{},dispatch(){},getState:()=>({routes:[]})});
export const useFocusEffect=callback=>React.useEffect(callback,[callback]);
export const Stack=Object.assign(({children})=>children,{Screen:()=>null});export const Link=({children})=>children;`;
modules['@react-navigation/native'] += 'export const usePreventRemove=()=>{};';
modules['react-native-webview'] = 'export const WebView=()=>null;export default WebView;';
modules['@react-native-masked-view/masked-view'] = `export {default} from '${resolve(repoRoot, 'server/node_modules/@react-native-masked-view/masked-view/js/MaskedView.web.js')}';`;
modules['@/track'] += 'export const tracking=null;export const trackOtaUpdateAvailable=()=>{};export const trackOtaUpdateApplied=()=>{};';
modules['@/realtime/RealtimeSession'] = 'export const stopRealtimeSession=async()=>{};export const getCurrentVoiceSessionDurationSeconds=()=>undefined;';
modules['@/sync/pushRegistration'] = `export const getCurrentExpoPushToken=()=>null;export const getCurrentPushDeviceMetadata=()=>({platform:'web'});export const getPushPermissionInfo=async()=>({status:'unsupported',granted:false,canAskAgain:false});export const requestPushPermissions=async()=>({granted:false});export const removeCurrentPushToken=async()=>{};export const syncPushToken=async()=>{};export const registerPushToken=async()=>{};export const requestPushPermissionOrOpenSettings=async()=>{};export const removePushToken=async()=>{};export const syncCurrentPushToken=async()=>{};`;
modules['@/encryption/libsodium'] = 'export const decryptBox=()=>null;export const decryptSecretBox=()=>null;export const encryptBox=v=>v;export const encryptSecretBox=v=>v;export const getPublicKeyForBox=v=>v;';
modules['@/encryption/libsodium.lib'] = 'export default {};';
modules['@/hooks/useUpdates'] = 'export const useUpdates=()=>({updateAvailable:false,isChecking:false,reloadApp(){}});';
modules['@/hooks/useNativeUpdate'] = 'export const useNativeUpdate=()=>null;';
modules['@/hooks/useChangelog'] = 'export const useChangelog=()=>({hasUnread:true,markAsRead(){}});';
modules['@/hooks/useNavigateToSession'] += 'export const useSessionPressHandlers=()=>({onPress(){}});';
modules['@/hooks/useSessionQuickActions'] = modules['@/hooks/useSessionQuickActions'].replace('useSessionQuickActions=()=>({', 'useSessionQuickActions=()=>({actionItems:[],') + 'export const useSessionActionAlert=()=>()=>{};';
modules['@/hooks/useNewSessionDraft'] = `const draft={selectedMachineId:'studio-mac',selectedPath:null,setMachineId(){},setCommanderId(){},setPath(){},setSessionType(){},setWorktreeKey(){},setInput(){},setAttachments(){}};export const useNewSessionDraft=Object.assign(selector=>selector(draft),{getState:()=>draft});`;

// Reanimated with shared values that re-render on write, so measured layout
// (the automation row reveal) reaches its settled height in a static capture.
modules['react-native-reanimated'] = `import React from 'react';import {View,Text,ScrollView,Image} from 'react-native';
const A={View,Text,ScrollView,Image,createAnimatedComponent:x=>x};export default A;
export const useSharedValue=v=>{const [,force]=React.useReducer(x=>x+1,0);const ref=React.useRef(null);if(!ref.current){let value=v;ref.current={get value(){return value},set value(next){if(next!==value){value=next;force();}}};}return ref.current;};
export const useAnimatedStyle=f=>f();export const useDerivedValue=f=>({value:f()});export const useAnimatedProps=f=>f();
export const withTiming=(v,_c,cb)=>{if(cb)setTimeout(()=>cb(true),0);return v;};export const withSpring=v=>v;export const withDelay=(_,v)=>v;export const withRepeat=v=>v;export const withSequence=(...v)=>v.at(-1);
export const cancelAnimation=()=>{};export const runOnJS=f=>f;export const interpolate=(x,a,b)=>b[0];export const interpolateColor=(x,a,b)=>b[0];export const Extrapolation={CLAMP:'clamp'};
export const Easing={linear:x=>x,quad:x=>x,cubic:x=>x,bezier:()=>x=>x,out:x=>x,in:x=>x,inOut:x=>x};
const animation={duration:()=>animation,easing:()=>animation,reduceMotion:()=>animation,withInitialValues:()=>animation,springify:()=>animation,damping:()=>animation};
export const FadeIn=animation,FadeOut=animation,FadeInDown=animation,FadeOutUp=animation,LinearTransition=animation;export const ReduceMotion={System:'system'};
export const useAnimatedRef=()=>React.useRef(null);export const measure=()=>null;export const useReducedMotion=()=>false;`;

const machines = `
const hours=h=>${now}-h*3600000;
function makeMachine(id,host,platform,active,homeDir){return {id,seq:1,active,activeAt:active?${now}:hours(30),createdAt:hours(900),updatedAt:${now},metadata:{host,displayName:id,platform,arch:'arm64',homeDir,happyCliVersion:'1.4.2',capabilitiesVersion:2,credentialManagementProtocolVersion:1,tools:{claude:{available:true},codex:{available:true},gemini:{available:platform==='darwin'}}},daemonState:active?{status:'running',pid:48213,httpPort:52331}:{status:'stopped'},metadataVersion:1,daemonStateVersion:1};}
export const machine=makeMachine('studio-mac','studio.local','darwin',true,'/Users/jordan');
const machines=[machine,makeMachine('build-box','build-box.internal','linux',true,'/home/example-user'),makeMachine('gpu-lab','gpu-lab.internal','linux',false,'/home/example-user')];`;

modules['@/sync/storage'] = `import React from 'react';import {settingsDefaults} from '@/sync/settings';
${machines}
function makeSession(id,name,path,project,flavor,minutes,extra={}){return {id,seq:12,active:true,activeAt:${now}-minutes*60000,createdAt:${now}-minutes*60000-3600000,updatedAt:${now}-minutes*60000,projectId:project,metadata:{name,summary:{text:name,updatedAt:${now}},path,host:'studio.local',machineId:'studio-mac',flavor,harness:flavor,version:'1.4.2',os:'darwin',homeDir:'/Users/jordan',claudeSessionId:'4b1e9c2a-81f3-4c1d-9d07-1f0c2e7ad0d7'},agentState:{controlledByUser:false,requests:{}},thinking:false,thinkingAt:0,presence:'online',draft:'',permissionMode:'default',modelMode:'default',...extra};}
export const session=makeSession('fixture-id','Refactor auth middleware','/Users/jordan/code/web-app','fixture-id','claude',4);
const sessions=[session,makeSession('s-docs','Release notes draft','/Users/jordan/code/docs','docs','codex',38),makeSession('s-api','Rate limiter for public API','/Users/jordan/code/api','fixture-id','claude',95),makeSession('s-tests','Flaky test triage','/Users/jordan/code/web-app','fixture-id','gemini',240)];
function project(id,name,minutes){return {id,externalId:'ext-'+id,name,kind:'personal',metadataVersion:1,avatar:null,createdAt:${now}-minutes*60000,updatedAt:${now}-minutes*60000};}
const projects={'fixture-id':project('fixture-id','Web app',60),docs:project('docs','Docs site',300),infra:project('infra','Infra',900)};
function row(s,state,minutes){return {botId:null,botUsername:null,machineName:'studio-mac',id:s.id,name:s.metadata.name,subtitle:s.metadata.path,avatarId:s.id,flavor:s.metadata.flavor,clientId:null,identityLine:null,providerKind:null,modelName:null,activitySummary:null,gitChangedFiles:null,gitCountsExact:true,gitDeletions:null,gitInsertions:null,state,createdAt:s.createdAt,lastActivityAt:${now}-minutes*60000,updateSequence:s.seq,hasDraft:false,active:true,archived:false,machineId:'studio-mac',daemonLabel:'studio-mac',daemonShortId:'studio-mac',commanderId:null,commanderName:null,machineOffline:false,path:s.metadata.path,homeDir:'/Users/jordan',completedTodosCount:0,totalTodosCount:0,hasUnread:false,projectId:s.projectId,projectName:projects[s.projectId]?.name??null,workspaceId:null,workspaceName:null};}
const listView=[{type:'session',session:row(sessions[0],'thinking',4)},{type:'session',session:row(sessions[2],'waiting',95)},{type:'session',session:row(sessions[3],'waiting',240)},{type:'session',session:row(sessions[1],'waiting',38)}];
export const profile={id:'review-user',firstName:'Jordan',lastName:'Park',username:'jpark',avatar:null,bio:null,connectedServices:['anthropic'],github:{login:'jpark'}};
const friend={id:'friend-review',firstName:'Robin',lastName:'Chen',username:'robin',avatar:null,bio:null,status:'friend',relationship:'friend'};
const feed=[{id:'feed-1',repeatKey:null,counter:3,createdAt:${now}-12*60000,body:{kind:'text',text:'Nightly dependency audit finished on studio-mac'}},{id:'feed-2',repeatKey:null,counter:2,createdAt:${now}-3*3600000,body:{kind:'friend_accepted',uid:'friend-review'}},{id:'feed-3',repeatKey:null,counter:1,createdAt:${now}-26*3600000,body:{kind:'text',text:'HappyHerd 1.4.2 is available on all machines'}}];
let version=0;const listeners=new Set();
const settings={...settingsDefaults,experiments:true,machineWorkspace:true,commanderProfilePictures:true,preferredLanguage:'en',voiceAssistantLanguage:'en',focusMode:new URLSearchParams(location.search).get('focus')==='active'?{projectId:'fixture-id',endsAt:Date.now()+18*60000+24000,startedAt:Date.now()-12*60000}:null};
const local={themePreference:new URLSearchParams(location.search).get('theme')||'light',devModeEnabled:false,commandPaletteEnabled:true};
function subscribe(cb){listeners.add(cb);return()=>listeners.delete(cb);}
function setSetting(k,v){settings[k]=typeof v==='function'?v(settings[k]):v;version++;window.__FOCUS_VALUE__=settings.focusMode;listeners.forEach(l=>l());}
function useVersion(){return React.useSyncExternalStore(subscribe,()=>version,()=>version);}
export const useSetting=k=>{useVersion();return settings[k];};export const useSettings=()=>{useVersion();return settings;};
export const useSettingMutable=k=>{useVersion();return [settings[k],v=>setSetting(k,v)];};
export const useLocalSetting=k=>local[k];export const useLocalSettingMutable=k=>React.useState(local[k]);
const state={sessions:Object.fromEntries(sessions.map(s=>[s.id,s])),machines:Object.fromEntries(machines.map(m=>[m.id,m])),projects,settings,profile,localSettings:local,sessionListViewData:listView,isDataReady:true,applySettings(){},setSessionDraft(){},updateSessionPermissionMode(){},updateSessionModelMode(){},applyFriends(){}};
export const storage=Object.assign(selector=>selector?selector(state):state,{getState:()=>state,setState(){},subscribe:()=>()=>{}});
export const useAllMachines=options=>options?.includeOffline?machines:machines.filter(m=>m.active);
export const useMachine=id=>machines.find(m=>m.id===id)??machine;
export const useSessions=()=>sessions;export const useAllSessions=()=>sessions;export const useSession=id=>sessions.find(s=>s.id===id)??session;
export const useProjects=()=>projects;export const useProject=id=>projects[id]??null;export const useProjectsLoaded=()=>true;
export const useSessionListViewData=()=>listView;export const useVisibleSessionListViewData=()=>listView;
export const useProfile=()=>profile;export const useUser=id=>id==='friend-review'?friend:null;export const useRealtimeMode=()=>null;
export const useAcceptedFriends=()=>[friend];export const useFriendRequests=()=>[];export const useRequestedFriends=()=>[];
export const useFeedItems=()=>feed;export const useFeedLoaded=()=>true;export const useFriendsLoaded=()=>true;
export const useRealtimeStatus=()=>'disconnected';export const useEntitlement=()=>false;export const useIsDataReady=()=>true;export const useSocketStatus=()=>'connected';
export const useSessionMessages=()=>[];export const useSessionUsage=()=>null;export const useMachineArtifacts=()=>[];export const useArtifacts=()=>[];export const useArtifact=()=>null;
`;

const memory = {
    'memory/1-working-memory.md': '# Athena — Current Operational Memory\n\n> Read USER.md for identity and preferences.\n\n## Current State\n\n- Shipping the secondary pages of the UI overhaul on a feature branch; parity rows go to the parent.\n- The daemon on studio-mac runs the nightly dependency audit at 02:00.\n\n## Live Constraints\n\n- Merge commits stay the default for repository pull requests.\n',
    'memory/2-long-term-memory.md': '# Athena — Long-Term Memory\n\n## Verification and Review\n\n- Treat build, tests, rendered behavior, deployment, and production behavior as separate gates.\n- A commit on the default branch does not prove deployment.\n',
};
const iso = minutes => new Date(now - minutes * 60000).toISOString();
const automationList = {
    'studio-mac': [
        { schemaVersion: 4, runtimeOwner: 'happyherd', id: '11111111-1111-4111-8111-111111111111', machineId: 'studio-mac', name: 'Nightly dependency audit', kind: 'scheduled', instruction: 'Run `pnpm audit` across the workspace, summarize new advisories by severity, and open one draft pull request per fixable package.\n\n- Skip dev-only advisories\n- Link each advisory', schedule: '0 2 * * *', timezone: 'America/New_York', workspace: '/Users/jordan/code/web-app', rail: 'claude', commanderId: 'athena', status: 'active', maxRetries: 2, tags: ['web-app', 'security'], createdAt: iso(90000), updatedAt: iso(900), lastScheduledAt: iso(600), lastRunAt: iso(600) },
        { schemaVersion: 4, runtimeOwner: 'happyherd', id: '22222222-2222-4222-8222-222222222222', machineId: 'studio-mac', name: 'Weekday standup digest', kind: 'scheduled', instruction: 'Summarize yesterday\'s merged pull requests and open review requests.', schedule: '30 8 * * 1-5', timezone: 'America/New_York', workspace: '/Users/jordan/code', rail: 'codex', commanderId: null, status: 'active', maxRetries: 0, tags: ['team'], createdAt: iso(90000), updatedAt: iso(900), lastScheduledAt: iso(1440), lastRunAt: iso(1440) },
        { schemaVersion: 4, runtimeOwner: 'happyherd', id: '33333333-3333-4333-8333-333333333333', machineId: 'studio-mac', name: 'Metrics data sink', kind: 'scheduled', schedule: '0 */2 * * *', timezone: 'UTC', workspace: '/Users/jordan/code/metrics', rail: 'exec', executable: '/usr/local/bin/pnpm', arguments: ['run', 'sink'], status: 'paused', tags: ['infra'], createdAt: iso(90000), updatedAt: iso(900), lastScheduledAt: null, lastRunAt: iso(5000) },
        { schemaVersion: 4, runtimeOwner: 'happyherd', id: '44444444-4444-4444-8444-444444444444', machineId: 'studio-mac', name: 'Commander memory upkeep', kind: 'memory-maintenance', instruction: 'Distill the week\'s observations into working memory.', schedule: '0 4 * * 0', timezone: 'America/New_York', workspace: '/Users/jordan/.happyherd', rail: 'claude', commanderId: 'athena', status: 'active', maxRetries: 1, tags: ['security'], createdAt: iso(90000), updatedAt: iso(900), lastScheduledAt: iso(9000), lastRunAt: iso(9000) },
    ],
    'build-box': [],
};
const baseRuns = [
    { id: 'aaaaaaa1-1111-4111-8111-111111111111', automationId: '11111111-1111-4111-8111-111111111111', source: 'schedule', scheduledFor: iso(600), startedAt: iso(600), finishedAt: iso(588), status: 'completed', attempt: 1, sessionId: 'session-r1', message: '3 advisories summarized; 1 draft pull request opened.' },
    { id: 'aaaaaaa2-1111-4111-8111-111111111111', automationId: '11111111-1111-4111-8111-111111111111', source: 'schedule', scheduledFor: iso(2040), startedAt: iso(2040), finishedAt: iso(2030), status: 'completed', attempt: 1, sessionId: 'session-r2', message: 'No new advisories.' },
    { id: 'aaaaaaa3-1111-4111-8111-111111111111', automationId: '11111111-1111-4111-8111-111111111111', source: 'schedule', scheduledFor: iso(3480), startedAt: null, finishedAt: iso(3480), status: 'skipped', attempt: 1, sessionId: null, message: 'Machine was asleep.' },
    { id: 'aaaaaaa4-1111-4111-8111-111111111111', automationId: '11111111-1111-4111-8111-111111111111', source: 'schedule', scheduledFor: iso(4920), startedAt: iso(4920), finishedAt: iso(4900), status: 'failed', attempt: 2, sessionId: null, message: 'Workspace lock held by another process.' },
];
const commanders = {
    'studio-mac': [
        { id: 'athena', name: 'Athena', role: 'Engineering commander for the web platform', workspace: '/Users/jordan/code', commanderPath: '/Users/jordan/.happyherd/commanders/athena/COMMANDER.md', agentContextPath: '/Users/jordan/.happyherd/commanders/athena/agentcontext' },
        { id: 'hermes', name: 'Hermes', role: 'Release and changelog steward', workspace: '/Users/jordan/code/docs', commanderPath: '/Users/jordan/.happyherd/commanders/hermes/COMMANDER.md', agentContextPath: '/Users/jordan/.happyherd/commanders/hermes/agentcontext' },
    ],
    'build-box': [
        { id: 'vulcan', name: 'Vulcan', role: 'CI and build infrastructure', workspace: '/home/example-user/ci', commanderPath: '/home/example-user/.happyherd/commanders/vulcan/COMMANDER.md', agentContextPath: '/home/example-user/.happyherd/commanders/vulcan/agentcontext' },
    ],
};
const opsSource = readFileSync(resolve(appRoot, 'sources/sync/ops.ts'), 'utf8');
const opNames = [...opsSource.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);
const opImplementations = {
    machineListAutomations: `async machineId=>({definitionSchemaVersion:4,automations:${JSON.stringify(automationList)}[machineId]??[]})`,
    machineAutomationHistory: `async (_m,id)=>{const runs=id==='11111111-1111-4111-8111-111111111111'?${JSON.stringify(baseRuns)}:[];return {runs:window.__FRESH_RUN__?[{...window.__FRESH_RUN__,status:'completed',finishedAt:new Date(${now}+90000).toISOString(),message:'Manual run finished: no new advisories.'},...runs]:runs};}`,
    machineRunAutomationNow: `async (_m,id)=>{const run={id:'fffffff0-1111-4111-8111-111111111111',automationId:id,source:'manual',scheduledFor:new Date(${now}).toISOString(),startedAt:new Date(${now}).toISOString(),finishedAt:null,status:'started',attempt:1,sessionId:'session-fresh',message:'Session accepted by the daemon and remains active until its provider exits.'};window.__FRESH_RUN__=run;return run;}`,
    machineListCommanders: `async machineId=>({globalAgentsPath:null,commanders:${JSON.stringify(commanders)}[machineId]??[]})`,
    machineReadFileWithinRoot: `async (_m,path)=>{const memory=${JSON.stringify(memory)};const file=Object.keys(memory).find(name=>path.endsWith(name));if(!file)return {success:false,error:'Not found'};const lines={hermes:'- Drafting the 1.4.2 release notes from merged pull requests.',vulcan:'- Keeping the CI cache warm for the nightly build matrix.'};const who=Object.keys(lines).find(id=>path.includes('/'+id+'/'));const text=who&&file.includes('working')?'# Working memory\\n\\n'+lines[who]+'\\n':memory[file];const bytes=new TextEncoder().encode(text);let binary='';bytes.forEach(b=>binary+=String.fromCharCode(b));return {success:true,content:btoa(binary)};}`,
    machineReadFile: `async ()=>({success:false,error:'No avatar in fixture'})`,
};
modules['@/sync/ops'] = opNames.map((name) => `export const ${name}=${opImplementations[name] ?? 'async()=>({})'};`).join('\n');

function onResolve(args) {
    if (args.path.startsWith('.') && args.importer.includes('/node_modules/')) {
        const stem = resolve(dirname(args.importer), args.path).replace(/\.js$/, '');
        for (const ext of ['.web.js', '.web.ts', '.web.tsx']) if (existsSync(stem + ext)) return { path: stem + ext };
    }
    if (args.path.startsWith('.') && args.importer.startsWith(resolve(appRoot, 'sources'))) {
        const key = '@/' + relative(resolve(appRoot, 'sources'), resolve(dirname(args.importer), args.path)).replace(/\.(tsx?|jsx?)$/, '');
        if (modules[key]) return { path: key, namespace: 'kilv-mock' };
    }
    return null;
}

const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const limitations = ['Synthetic machines, automations, Commanders, projects, sessions, and inbox items; not authenticated live evidence.', 'Expo Router Stack headers are outside this component fixture; the page body renders below where the header would be.', 'Unistyles `_web` CSS (glows, rings) is rendered; CSS motion classes are not, since screenshots disable animation.'];
const H = 'components/herd/pages/';
const scenes = [
    {
        id: 'automations', label: 'Automations', sources: ['app/(app)/automations/index.tsx', 'components/HappyHerdAutomationDetail.tsx', `${H}HerdCollapse.tsx`, `${H}HerdSheet.tsx`],
        async run(page, shot, wide) {
            await page.getByText('Nightly dependency audit', { exact: true }).waitFor();
            await shot('list');
            await page.getByRole('button', { name: 'Show details for Nightly dependency audit', exact: true }).click();
            await page.getByText('Previous runs', { exact: true }).waitFor();
            await page.waitForTimeout(250);
            await shot('expanded');
            await page.getByRole('button', { name: 'Run now', exact: true }).click();
            await page.getByText('Running', { exact: true }).waitFor();
            if (!wide) await page.getByText('Previous runs', { exact: true }).scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            await shot('run-now-running');
            await page.getByRole('button', { name: 'History', exact: true }).click();
            await page.getByText('Manual run finished: no new advisories.', { exact: true }).waitFor();
            if (!wide) await page.getByText('Previous runs', { exact: true }).scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            await shot('history-completed');
            await page.getByRole('button', { name: 'New', exact: true }).click();
            await page.getByText('New automation', { exact: true }).first().waitFor();
            await page.waitForTimeout(150);
            await shot(wide ? 'create-sheet' : 'create-inline');
        },
    },
    {
        id: 'commanders', label: 'Commanders', sources: ['app/(app)/commanders/index.tsx', `${H}commanderMemory.ts`, `${H}HerdSheet.tsx`],
        async run(page, shot) {
            await page.getByText('Athena', { exact: true }).first().waitFor();
            await page.waitForTimeout(300);
            await shot('cards');
            await page.getByRole('button', { name: 'Athena · memory/1-working-memory.md', exact: true }).click();
            await page.getByText('Current State', { exact: true }).waitFor();
            await page.waitForTimeout(150);
            await shot('memory-sheet');
        },
    },
    {
        id: 'settings', label: 'Settings', sources: ['app/(app)/settings/index.tsx', `${H}SettingsFrame.tsx`, 'components/SettingsView.tsx', 'app/(app)/settings/appearance.tsx'],
        async run(page, shot, wide) {
            await page.getByText('Connected Accounts', { exact: false }).first().waitFor();
            await shot('general');
            if (wide) {
                await page.getByTestId('settings-nav-appearance').click();
                await page.getByTestId('settings-nav-appearance').waitFor();
                await page.waitForFunction(() => document.querySelector('[data-testid="settings-nav-appearance"]')?.getAttribute('aria-selected') === 'true');
                await page.waitForTimeout(200);
                await shot('appearance-selected');
            }
        },
    },
    {
        id: 'projects', label: 'Projects', sources: ['app/(app)/projects/index.tsx', 'app/(app)/projects/[id].tsx'],
        async run(page, shot) {
            await page.getByText('Web app', { exact: true }).first().waitFor();
            await shot('cards');
            await page.getByRole('button', { name: 'Web app', exact: true }).click();
            await page.getByTestId('project-detail-screen').waitFor();
            await page.waitForTimeout(200);
            await shot('detail');
        },
    },
    {
        id: 'inbox', label: 'Inbox', sources: ['app/(app)/inbox/index.tsx', 'components/InboxView.tsx', 'components/FeedItemCard.tsx', `${H}HerdList.tsx`],
        async run(page, shot) {
            await page.getByText('Nightly dependency audit finished on studio-mac', { exact: true }).waitFor();
            await shot('feed');
        },
    },
    {
        id: 'session-info', label: 'Session details', sources: ['app/(app)/session/[id]/info.tsx', `${H}HerdList.tsx`],
        async run(page, shot) {
            await page.getByText('Quick Actions', { exact: false }).first().waitFor();
            await shot('details');
        },
    },
    {
        id: 'machine', label: 'Machine', sources: ['app/(app)/machine/[id].tsx', `${H}HerdList.tsx`],
        async run(page, shot) {
            await page.waitForTimeout(400);
            await shot('details');
        },
    },
    {
        id: 'changelog', label: "What's New", sources: ['app/(app)/changelog.tsx', `${H}HerdTimeline.tsx`],
        async run(page, shot) {
            await page.waitForTimeout(300);
            await shot('timeline');
        },
    },
    {
        id: 'focus', label: 'Focus mode', sources: ['components/FocusModeControl.tsx', 'components/herd/SegmentedControl.tsx'],
        async run(page, shot) {
            await page.getByTestId('focus-mode-enter').click();
            await page.getByTestId('focus-mode-pixel-swap').waitFor();
            await page.waitForTimeout(650);
            await shot('pixel-swap');
            await page.getByRole('heading', { name: 'Reclaim Your Focus', exact: true }).waitFor({ timeout: 5000 });
            await page.getByRole('radio', { name: '45 min', exact: true }).click();
            await page.getByRole('radio', { name: 'Web app', exact: true }).click();
            await page.waitForTimeout(150);
            await shot('setup');
            await page.getByRole('button', { name: 'Start focus', exact: true }).click();
            await page.getByTestId('focus-mode-timer').waitFor();
            await page.waitForTimeout(150);
            await shot('countdown-pill');
        },
    },
    {
        id: 'focus-active', scene: 'focus', query: { focus: 'active' }, label: 'Focus countdown (resumed)', sources: ['components/FocusModeControl.tsx'],
        async run(page, shot) {
            await page.getByTestId('focus-mode-timer').waitFor();
            await shot('ring-progress');
        },
    },
    {
        id: 'palette', label: 'Command palette', sources: ['components/CommandPalette/CommandPalette.tsx', 'components/CommandPalette/CommandPaletteItem.tsx', 'components/CommandPalette/CommandPaletteInput.tsx', 'components/CommandPalette/CommandPaletteResults.tsx', 'components/CommandPalette/CommandPaletteModal.tsx'],
        async run(page, shot) {
            await page.getByPlaceholder('Type a command or search...').waitFor();
            await page.waitForTimeout(400);
            await shot('open');
            await page.getByPlaceholder('Type a command or search...').fill('se');
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(200);
            await shot('filtered-highlight');
        },
    },
];

const capture = await createCapture({
    group: 'pages',
    entrySource: readFileSync(resolve(repoRoot, 'scripts/kilv-capture/pages.fixture.tsx'), 'utf8'),
    virtualModules: modules,
    onResolve,
    outDir,
});
const failures = [];
try {
    for (const scene of scenes.filter((entry) => !selected || selected.includes(entry.id))) {
        for (const theme of ['light', 'dark']) for (const viewport of viewports) {
            const page = await capture.open({
                theme,
                viewport,
                params: { scene: scene.scene ?? scene.id, ...(scene.query ?? {}) },
                init: () => {
                    globalThis.process = { env: {} };
                    window.addEventListener('error', (event) => { window.__CAPTURE_ERROR__ = event.error?.stack || event.message; });
                },
            });
            if (process.env.PAGES_CAPTURE_DEBUG) page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') console.error('CONSOLE', message.text().slice(0, 400)); });
            const shot = (state) => capture.capture(page, { panelId: scene.id, label: scene.label, sourcePaths: scene.sources, state, limitations });
            try {
                await page.waitForTimeout(500);
                await scene.run(page, shot, viewport.width >= 900);
                console.log('CAPTURE', scene.id, theme, viewport.width);
            } catch (error) {
                console.error('FAILED', scene.id, theme, viewport.width, error, await page.evaluate(() => window.__CAPTURE_ERROR__).catch(() => null));
                if (process.env.PAGES_CAPTURE_DEBUG) {
                    console.error('BODY', (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
                    await page.screenshot({ path: resolve(outDir, `debug-${scene.id}-${theme}-${viewport.width}.png`), fullPage: true }).catch(() => {});
                }
                failures.push({ scene: scene.id, theme, viewport, error: String(error) });
            } finally {
                await page.close();
            }
        }
    }
} finally {
    await capture.close();
}
if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
}
