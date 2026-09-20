import {createCapture,readFixtureModules,repoRoot,appRoot} from './common.mjs';
import {resolve,relative,dirname} from 'node:path';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
const virtualModules=readFixtureModules('sources/components/sideChatHeader.browser.test.ts',{resolve,newSessionProjectPath:'/work/project',newSessionRecentPath:i=>'/work/project-'+i});
// Keep only the fixture's external/service boundaries; all capture targets are real.
for(const key of ['@/text','expo-linear-gradient','@/components/AgentContentView','@/components/AgentGoalBar','@/components/QueuedMessagesPanel','@/components/EmptyMessages','@/components/SessionStatusBar','@/components/VoiceAssistantStatusBar','@/components/ProviderIcon','@/components/BubblePressable','@/components/modelModeOptions','@/components/agentGoalStatus','@/sync/queueProjection','@/utils/sessionStatusBar','@/components/diff/PierreDiffView'])delete virtualModules[key];
// Preserve fixture session identities/resume boundaries, but derive status from production.
const inheritedStatusExport = /export const useSessionStatus = [^\n]+;/;
if (!inheritedStatusExport.test(virtualModules['@/utils/sessionUtils'])) throw new Error('Fixture useSessionStatus export changed; inspect its adapter before capturing');
virtualModules['@/utils/sessionUtils'] = virtualModules['@/utils/sessionUtils'].replace(
 inheritedStatusExport,
 `export { useSessionStatus } from '${resolve(appRoot,'sources/utils/sessionUtils.ts')}';`,
);
virtualModules['expo-localization']=`export const getLocales=()=>[{languageTag:'en-US',languageCode:'en'}];`;
virtualModules['@/sync/persistence']=`export const loadSettings=()=>({settings:{preferredLanguage:'en'}});export const storeTempText=()=> 'synthetic-temp';`;
virtualModules['@/realtime/RealtimeSession']=`export const stopRealtimeSession=async()=>{};export const getCurrentVoiceSessionDurationSeconds=()=>83;`;
virtualModules['@/hooks/useAttachmentImage']=`export const useAttachmentImage=()=>({uri:${JSON.stringify('data:image/webp;base64,'+readFileSync(resolve(appRoot,'sources/assets/images/kilv-mark-dark.webp')).toString('base64'))},error:null});`;
virtualModules['@/sync/storage']+=`\nexport const useRealtimeMode=()=> 'listening';`;
virtualModules['@/sync/storage']=virtualModules['@/sync/storage'].replace("const messages = Array.from", "const oldFixtureMessages = Array.from");
const syntheticMessages=[{kind:'agent-text',id:'capture-agent',localId:null,createdAt:1003,text:'The interface uses **shared design tokens**.\n\n- Warm, readable surfaces\n- Clear primary and secondary actions\n- Compact navigation\n\nThe focused verification passed.'},{kind:'tool-call',id:'capture-tool',localId:null,createdAt:1002,children:[],tool:{name:'Bash',title:'Run focused tests',state:'completed',input:{command:'pnpm --filter happy-app test'},result:'73 tests passed',createdAt:1001,startedAt:1001,completedAt:1002}},{kind:'user-text',id:'capture-user',localId:null,createdAt:1000,text:'Review the session UI and run the focused checks.'}];
virtualModules['@/sync/storage']=virtualModules['@/sync/storage'].replace('const localhostMessages =',`const messages = ${JSON.stringify(syntheticMessages)};\nconst localhostMessages =`);
virtualModules['react-native-keyboard-controller']+=`export const useKeyboardState=()=>({isVisible:false,height:0});`;
// Native animation clock is frozen for deterministic stills. The actual renderers remain imported.
virtualModules['react-native-reanimated']=virtualModules['react-native-reanimated'].replace('export default { ScrollView, Text, View };','export default { ScrollView, Text, View, createAnimatedComponent:(Component)=>Component };')+`export const cancelAnimation=()=>{};export const withSpring=v=>v;export const useAnimatedRef=()=>React.useRef(null);export const measure=()=>({width:24,height:24});`;
// DOM has no native alpha-mask host. This boundary is called out as a verification gap.
virtualModules['@react-native-masked-view/masked-view']=`import React from 'react';import {View} from 'react-native';export default ({maskElement,style})=>React.createElement(View,{style},maskElement);`;
const sceneSources={
 session:['-session/SessionView','components/AgentInput','components/ChatList','components/MessageView'],
 'chat-list':['components/ChatList','components/MessageView'],composer:['components/AgentInput'],messages:['components/MessageView'],
 'goal-work-queue':['components/AgentGoalBar','components/AgentWorkGroupHeader','components/QueuedMessagesPanel'],empty:['components/EmptyMessages'],
 status:['components/SessionStatusBar','components/VoiceAssistantStatusBar','components/ShimmerView'],'attachment-menu':['components/AttachmentInputMenu'],question:['components/AgentQuestionModal'],continuation:['components/ProviderContinuationLinks','components/ProviderContinuationSheet'],'session-actions':['components/SessionActionsPopover'],
 'native-editor':['components/CodeEditor'],
 'native-text':['components/markdown/MarkdownView','components/CodeView','components/CommandView'],'tool-shells':['components/tools/ToolView','components/tools/views/CodexBashView','components/tools/views/GeminiExecuteView'],
 'tool-full':['components/tools/ToolFullView'],'tool-states':['components/tools/ToolSectionView','components/tools/ToolError','components/tools/ToolStatusIndicator','components/tools/PermissionFooter'],
 'tool-patch':['components/tools/views/CodexPatchView','components/tools/views/MultiEditViewFull'],'tool-file':['components/tools/views/FileView'],'tool-question':['components/tools/views/InlineQuestionForm'],'tool-agents':['components/tools/views/SubagentView','components/tools/views/TaskView','components/tools/views/TodoView'],
 controls:['components/RoundButton','components/Item','components/ItemGroup'],selector:['components/SearchableListSelector'],alert:['modal/components/BaseModal','modal/components/WebAlertModal'],prompt:['modal/components/BaseModal','modal/components/WebPromptModal']};
const states={session:'Synthetic Codex session with user message, completed work group, agent reply and composer', 'chat-list':'Synthetic user/agent transcript with collapsed completed work',composer:'Unsent draft with attachment and send actions',messages:'User bubble and formatted agent reply','goal-work-queue':'Goal actions, collapsed and expanded work summaries, one active and two queued messages',empty:'New session with no messages',status:'36% context use, model and effort labels, connected voice at 1:23','attachment-menu':'Open menu with device-file and photo actions',question:'Unanswered required question; submit disabled',continuation:'Current Codex session, available Claude continuation and existing continuation link','session-actions':'Open session actions menu','native-text':'Native Markdown renderer with bold/italic/link/list/quote/code, CodeView, and terminal stdout/stderr','tool-shells':'Compact completed Bash tool, Codex command, and Gemini command','tool-full':'Generic tool details with synthetic error result','tool-states':'Running/completed/error indicators, error banner and pending permission request','tool-patch':'Compact patch, expanded patch, and replace-all multiple edit','tool-file':'Loaded synthetic attachment image','tool-question':'Required inline question awaiting answer','tool-agents':'Expanded completed subagent trace, task activity and three todo states',controls:'Primary/secondary/disabled/loading buttons and default/selected/destructive/disabled items',selector:'Selected workspace path with favorites/recent/search controls',alert:'Open destructive confirmation',prompt:'Open rename prompt with focused input'};
const descriptions={
 session:['Session conversation and composer','Session surfaces, reply island and composer adopt the shared KILV palette and typography.'],
 'chat-list':['Conversation transcript','Transcript text and work summaries use the shared font and theme hierarchy.'],
 composer:['Message composer with draft','Composer border, input text and send/attachment controls use KILV tokens.'],
 messages:['Human and agent messages','Human text and formatted agent replies use themed surfaces and shared typography.'],
 'goal-work-queue':['Goal, completed work and message queue','Goal and queue text adopt the shared type hierarchy and theme colors.'],
 empty:['Empty conversation','Host, path and empty-message copy use the shared display and monospaced fonts.'],
 status:['Session status and connected voice','Model/context status and voice controls use themed colors and shared fonts.'],
 'attachment-menu':['Attachment source menu','Device-file and photo actions adopt the shared menu border, radius, palette and typography.'],
 question:['Agent question modal','Question headings, options, selected controls and submit action use the shared KILV palette and fonts.'],
 continuation:['Provider continuation links and sheet','Continuation text, provider choices and links adopt shared typography and themed surfaces.'],
 'session-actions':['Session actions popover','Action rows and destructive state use themed colors and shared type.'],
 'native-text':['Native Markdown, code and terminal renderers','Native text renderers use Space Grotesk and JetBrains Mono with themed code and terminal surfaces.'],
 'native-editor':['Native code editor','The native multiline editor now derives its monospaced face from Typography.mono().'],
 'tool-shells':['Compact tool and provider command results','Tool labels and Codex/Gemini command renderers adopt shared type and KILV command colors.'],
 'tool-full':['Tool detail and error result','Tool detail sections use themed headings, code surfaces and error styling.'],
 'tool-states':['Tool execution and permission states','Running/completed/error indicators and permission actions use semantic theme colors.'],
 'tool-patch':['Compact patch, expanded patch and multiple edits','Patch labels and edit summaries adopt the shared typography and themed action colors.'],
 'tool-file':['Image attachment result','Attachment filename uses the shared typography alongside the themed image boundary.'],
 'tool-question':['Inline question form','Question labels, options and submit/cancel actions adopt the shared theme and type.'],
 'tool-agents':['Subagent trace, task activity and checklist','Agent outcomes, nested activity and task checklist text adopt shared fonts and semantic status colors.'],
 controls:['Shared button and item states','Buttons and item groups use KILV borders, radii, colors and typography across action states.'],
 selector:['Searchable path selector','Search and selected/favorite rows use the shared palette, borders, radii and fonts.'],
 alert:['Destructive confirmation modal','Alert content uses the dark lifted surface and themed destructive action.'],
 prompt:['Text entry modal','Prompt content and input use shared typography, themed surfaces and focus styling.'],
};
const previousManifestPath=resolve(repoRoot,'docs/acceptance/issue-287/panels/chat/manifest.json');
const previousManifest=process.env.KILV_SCENES&&existsSync(previousManifestPath)?JSON.parse(readFileSync(previousManifestPath,'utf8')):[];
const capture=await createCapture({group:'chat',entrySource:readFileSync(resolve(repoRoot,'scripts/kilv-capture/chat.tsx'),'utf8').replaceAll('../../server/packages/happy-app/sources/',resolve(appRoot,'sources')+'/'),virtualModules,onResolve(args){
 if(args.path.startsWith('.')&&args.importer.startsWith(resolve(appRoot,'sources'))){const key='@/'+relative(resolve(appRoot,'sources'),resolve(dirname(args.importer),args.path)).replace(/\.(tsx?|jsx?)$/,'');if(key in virtualModules)return{path:key,namespace:'kilv-mock'};}
 if(args.resolveDir.includes('/@shopify/flash-list/')&&args.path.startsWith('.')){const path=resolve(args.resolveDir,args.path+'.web.js');if(existsSync(path))return{path};}
},css:'html,body,#root{width:100%;}body{overflow-x:hidden;}'});
// The shared environment lists module-level adapters; document this real-export exception.
const environmentPath=resolve(capture.directory,'environment-chat.json');
const environment=JSON.parse(readFileSync(environmentPath,'utf8'));
environment.partialAdapters={
 '@/utils/sessionUtils':{
  realExports:['useSessionStatus'],
  realSource:'sources/utils/sessionUtils.ts',
  fixtureExports:['formatOSPlatform','formatPathRelativeToHome','formatLastSeen','getResumeCommand','getResumeCommandBlock','getSessionAvatarId','getSessionName'],
 },
};
writeFileSync(environmentPath,JSON.stringify(environment,null,2)+'\n');
try{
 const scenes=process.env.KILV_SCENES?.split(',')??Object.keys(sceneSources);
 const themes=process.env.KILV_THEME?[process.env.KILV_THEME]:['light','dark'];
 const widths=process.env.KILV_WIDTH?[Number(process.env.KILV_WIDTH)]:[1440,390];
 for(const entry of previousManifest){if(scenes.includes(entry.panelId)&&themes.includes(entry.theme)&&widths.includes(entry.viewport.width))continue;delete entry.mockModules;entry.label=descriptions[entry.panelId][0]+(entry.state==='selected-answer'?' — selected answer':'');entry.changeDescription=descriptions[entry.panelId][1];capture.manifest.push(entry);}
 for(const scene of scenes)for(const theme of themes)for(const width of widths){
  const page=await capture.open({theme,viewport:{width,height:width===390?844:900},params:{scene},init:()=>{globalThis.__HAPPYHERD_FIXTURE_OPTIONS__={providerContinuation:true,realtimeStatus:new URLSearchParams(location.search).get('scene')==='status'?'connected':'disconnected'};}});
  try{
   await page.locator('[data-testid="capture-panel"]').waitFor();
   if(scene==='tool-agents')await page.getByRole('button',{name:'Expand sub-agent activity'}).click();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   // RN Modal uses a finite entry animation: wait for its actual completion.
   await page.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState==='finished'));
   if(scene==='question')await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='FIXTURE';badge.style.cssText='position:fixed;right:8px;top:10px;z-index:2147483647;font:10px SpaceGrotesk-Regular;color:#8F6E36;pointer-events:none';document.body.appendChild(badge);});
   if(scene==='tool-file')await page.waitForFunction(()=>Array.from(document.images).some(image=>image.complete&&image.naturalWidth>100));
   let onlineStatusEvidence;
   if(['session','composer'].includes(scene)){
    onlineStatusEvidence=await page.getByText('online',{exact:true}).evaluate(element=>({labelColor:getComputedStyle(element).color,dotColor:getComputedStyle(element.previousElementSibling).backgroundColor,dotWidth:element.previousElementSibling.getBoundingClientRect().width,sourcePath:'sources/utils/sessionUtils.ts#useSessionStatus'}));
    if(onlineStatusEvidence.labelColor!=='rgb(52, 199, 89)'||onlineStatusEvidence.dotColor!=='rgb(52, 199, 89)'||onlineStatusEvidence.dotWidth!==6)throw new Error('Online status did not render the production #34C759 label and dot: '+JSON.stringify(onlineStatusEvidence));
   }
   const fontEvidence=await page.evaluate(()=>{
    const familyName=value=>value.replace(/["']/g,'').trim();
    const faces=[...document.fonts];
    const declared=new Map(faces.map(face=>[familyName(face.family),face]));
    const used=new Set();
    for(const element of document.querySelectorAll('*')){
     if(!element.getClientRects().length)continue;
     const hasText=[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())||('value' in element&&element.value);
     if(!hasText)continue;
     const family=familyName(getComputedStyle(element).fontFamily.split(',')[0]);
     if(declared.has(family))used.add(family);
    }
    return [...used].sort().map(family=>({family,status:declared.get(family).status,available:document.fonts.check('16px "'+family+'"')}));
   });
   if(!fontEvidence.some(font=>font.family==='SpaceGrotesk-Regular')||fontEvidence.some(font=>font.status!=='loaded'||!font.available))throw new Error('Actual visible fonts are not loaded: '+JSON.stringify(fontEvidence));
   const limitations=['RPC, storage, authentication, navigation, native glass, keyboard, gestures and animation clocks use deterministic fixture boundaries. Actual target components, theme, Typography, catalogs and font assets are imported. No account data is used. Session online status uses the actual production useSessionStatus export; other session identity/resume helpers retain fixture boundaries.'];
   if(['status','native-text','native-editor'].includes(scene))limitations.push('Native renderer hosted in DOM only. Installed iOS/Android text metrics, alpha masks, shimmer motion, keyboard and platform glass remain unverified. Shimmer alpha mask is replaced by its mask element for the still.');
   if(scene==='tool-file')limitations.push('Attachment download/decryption hook returns repository KILV artwork as a synthetic image. No backend transfer verified.');
   await capture.capture(page,{panelId:scene,label:descriptions[scene][0],sourcePaths:sceneSources[scene].map(p=>'server/packages/happy-app/sources/'+p+'.tsx'),state:'synthetic-review',fontEvidence,stateDescription:states[scene]??'Editable and read-only synthetic TypeScript values',limitations,changeDescription:descriptions[scene][1],...(onlineStatusEvidence?{onlineStatusEvidence}:{}),visibleBodyText:(await page.locator('body').innerText()).slice(0,3000)});
   if(['question','tool-question'].includes(scene)){
    await page.getByText('Focused tests',{exact:true}).click();
    await capture.capture(page,{panelId:scene,label:descriptions[scene][0]+' — selected answer',sourcePaths:sceneSources[scene].map(p=>'server/packages/happy-app/sources/'+p+'.tsx'),state:'selected-answer',fontEvidence,stateDescription:'Focused tests selected via actual visible option; submit enabled; no submit RPC invoked',limitations,changeDescription:descriptions[scene][1]});
   }
   console.log(`captured ${scene} ${theme} ${width}`);
  }catch(error){console.error('SCENE_FAILED',scene,theme,width,await page.locator('body').innerText());writeFileSync(resolve(capture.directory,`failure-${scene}-${theme}-${width}.json`),JSON.stringify({scene,theme,width,error:String(error)},null,2));throw error;}finally{await page.close();}
 }
 writeFileSync(resolve(capture.directory,'README.md'),'# Chat and shared-control review evidence\n\nRun from repository root: `node scripts/kilv-capture/chat.mjs`. Requires installed app dependencies and Chrome. `KILV_SCENES`, `KILV_THEME`, and `KILV_WIDTH` narrow the matrix.\n\nAll images use real production components with synthetic service/state inputs; see each manifest entry for boundaries. These are component fixtures, not live authenticated sessions or installed native-app screenshots. Native Markdown and CodeEditor are explicitly imported but rendered through React Native Web; native alpha masks, motion, platform glass and keyboard need device verification.\n\nCreate thumbnail sheets with `python3 scripts/kilv-capture/chat.contact.py` (Pillow required). Question variants include a visible FIXTURE badge and an option selected through the actual UI. The contact sheets are derived review aids; manifest.json identifies the original panel screenshots and their evidence boundaries.\n');
}finally{await capture.close();}
