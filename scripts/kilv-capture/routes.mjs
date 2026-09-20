// Run: node scripts/kilv-capture/routes.mjs [optional comma-separated panel IDs]
import {readFileSync,existsSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createCapture,appRoot,repoRoot} from './common.mjs';
import {virtualModules} from './routes.mocks.mjs';
const usageChartLimitation="Known pre-existing chart clipping: upper bars and value labels are clipped by the horizontal ScrollView. Chart height, padding, and bar-scaling geometry are unchanged from baseline 189c504b; KILV changes only typography and semantic colors. The screenshot preserves this defect.";
const panels=[
 ['artifacts','Artifacts','app/(app)/artifacts/index.tsx'],['artifact','Artifact details','app/(app)/artifacts/[id].tsx'],
 ['artifact-new','New artifact editor','app/(app)/artifacts/new.tsx'],['artifact-edit','Edit artifact','app/(app)/artifacts/edit/[id].tsx'],
 ['friends','Friends','app/(app)/friends/index.tsx'],['friend-search','Find friends','app/(app)/friends/search.tsx','components/UserSearchResult.tsx'],
 ['inbox','Inbox','app/(app)/inbox/index.tsx'],['machine','Machine details','app/(app)/machine/[id].tsx'],
 ['session-info','Session details','app/(app)/session/[id]/info.tsx'],['recent','Recent sessions','app/(app)/session/recent.tsx'],
 ['account','Account settings','app/(app)/settings/account.tsx'],['account-key','Synthetic account key','components/AccountKeyPanel.tsx'],
 ['agents','Agent defaults','app/(app)/settings/agents.tsx'],['appearance','Appearance','app/(app)/settings/appearance.tsx'],
 ['features','Features','app/(app)/settings/features.tsx'],['commanders','Commander profile pictures','components/CommanderAvatarSettings.tsx'],
 ['language','Interface language','app/(app)/settings/language.tsx'],['voice','Voice settings','app/(app)/settings/voice.tsx','components/usage/UsageBar.tsx'],
 ['voice-language','Voice language','app/(app)/settings/voice/language.tsx'],['claude','Connect Claude','app/(app)/settings/connect/claude.tsx'],
 ['terminal','Connect terminal','app/(app)/terminal/connect.tsx'],['text-selection','Select text','app/(app)/text-selection.tsx'],
 ['terminal-confirm','Terminal connection request','app/(app)/terminal/index.tsx'],['terminal-invalid','Invalid terminal link','app/(app)/terminal/index.tsx'],
 ['user','User profile','app/(app)/user/[id].tsx'],['settings','Settings','components/SettingsView.tsx'],
 ['credentials','Saved credentials','components/CredentialsSettingsView.tsx'],['usage','Provider usage','components/usage/UsagePanel.tsx','components/usage/UsageChart.tsx','components/usage/UsageBar.tsx'],
];
const opsSource=readFileSync(resolve(appRoot,'sources/sync/ops.ts'),'utf8');
const opNames=[...opsSource.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]);
virtualModules['@/sync/ops']=opNames.map(name=>`export const ${name}=async()=>${name==='machineListCommanders'?`({commanders:[{id:'review-commander',name:'Review Commander',description:'Synthetic review commander',path:'/Users/reviewer/AgentContext/review',avatar:null}]})`:'({})'};`).join('\n');
virtualModules['@/track']+='export const tracking=null;';
virtualModules['@/hooks/useNewSessionDraft']=`const draft={selectedMachineId:'fixture-id',selectedPath:'/Users/reviewer/Projects/demo',agentType:'claude',permissionMode:null,modelMode:null,effortLevel:null};export const useNewSessionDraft=Object.assign(selector=>selector(draft),{getState:()=>draft});`;
virtualModules['@/sync/pushRegistration']=`export const getCurrentExpoPushToken=()=>null;export const getCurrentPushDeviceMetadata=()=>({platform:'web'});export const getPushPermissionInfo=async()=>({status:'unsupported',granted:false,canAskAgain:false});export const requestPushPermissions=async()=>({granted:false});export const removeCurrentPushToken=async()=>{};export const syncPushToken=async()=>{};export const registerPushToken=async()=>{};`;
virtualModules['@/sync/apiUsage']=`export * from '${resolve(appRoot,'sources/sync/apiUsage.ts')}';export const getUsageForPeriod=async()=>({usage:Array.from({length:7},(_,i)=>({timestamp:Math.floor(Date.now()/1000)-(6-i)*86400,tokens:{total:3500+i*400,claude:1800+i*200,codex:1700+i*200},cost:{total:.12+i*.03,claude:.12+i*.03},reportCount:4+i})),coverage:[{provider:'claude',tokens:'reported',cost:'reported',limitations:[],costBasis:['provider-estimate']},{provider:'codex',tokens:'reported',cost:'unavailable',limitations:['cost-not-reported-by-provider'],costBasis:['unavailable']}]});`;
virtualModules['@/encryption/libsodium']=`export const decryptBox=()=>null;export const decryptSecretBox=()=>null;export const encryptBox=v=>v;export const encryptSecretBox=v=>v;export const getPublicKeyForBox=v=>v;`;
virtualModules['@/encryption/libsodium.lib']=`export default {};`;
virtualModules['@react-native-masked-view/masked-view']=`export {default} from '${resolve(repoRoot,'server/node_modules/@react-native-masked-view/masked-view/js/MaskedView.web.js')}';`;
virtualModules['@react-navigation/native']+='export const usePreventRemove=()=>{};';
virtualModules['react-native-webview']='export const WebView=()=>null;export default WebView;';
virtualModules['@/track']+='export const trackOtaUpdateAvailable=()=>{};export const trackOtaUpdateApplied=()=>{};';
virtualModules['@/sync/storage']+='export const useUser=()=>profile;export const useRealtimeMode=()=>null;';
virtualModules['@/realtime/RealtimeSession']='export const stopRealtimeSession=async()=>{};export const getCurrentVoiceSessionDurationSeconds=()=>undefined;';
virtualModules['@/sync/pushRegistration']+='export const requestPushPermissionOrOpenSettings=async()=>{};export const removePushToken=async()=>{};export const syncCurrentPushToken=async()=>{};';
virtualModules['react-native-reanimated']=virtualModules['react-native-reanimated'].replace("out:x=>x,inOut", "out:x=>x,in:x=>x,inOut").replace("export const FadeIn={duration:()=>({})};export const FadeOut=FadeIn;", "const animation={duration:()=>animation,easing:()=>animation,reduceMotion:()=>animation,withInitialValues:()=>animation};export const FadeIn=animation,FadeOut=animation,FadeInDown=animation,FadeOutUp=animation,LinearTransition=animation;export const ReduceMotion={System:'system'};export const useAnimatedRef=()=>React.useRef(null);export const measure=()=>null;");
function onResolve(args){if(args.path.startsWith('.')&&args.importer.includes('/node_modules/')){const stem=resolve(dirname(args.importer),args.path).replace(/\.js$/,'');for(const ext of ['.web.js','.web.ts','.web.tsx'])if(existsSync(stem+ext))return {path:stem+ext};}if(args.path.startsWith('.')&&args.importer.startsWith(resolve(appRoot,'sources'))){const key='@/'+relative(resolve(appRoot,'sources'),resolve(dirname(args.importer),args.path)).replace(/\.(tsx?|jsx?)$/,'');if(virtualModules[key])return {path:key,namespace:'kilv-mock'};}return null;}
virtualModules['@/hooks/useUpdates']=`export const useUpdates=()=>({updateAvailable:false,isChecking:false,reloadApp(){}});`;
virtualModules['@/hooks/useNativeUpdate']=`export const useNativeUpdate=()=>null;`;
virtualModules['@/hooks/useChangelog']=`export const useChangelog=()=>({hasUnread:true,markAsRead(){}});`;
const capture=await createCapture({group:'routes',entrySource:readFileSync(resolve(repoRoot,'scripts/kilv-capture/routes.fixture.tsx'),'utf8'),virtualModules,onResolve});
const selected=process.argv[2]?.split(',');
if(selected&&existsSync(resolve(capture.directory,'manifest.json')))capture.manifest.push(...JSON.parse(readFileSync(resolve(capture.directory,'manifest.json'),'utf8')).filter(item=>!selected.includes(item.panelId)));
const failures=[];
try {
 for(const [panelId,label,...paths] of panels.filter(x=>!selected||selected.includes(x[0]))) {
  for(const theme of ['light','dark']) for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
   const page=await capture.open({theme,viewport,params:{scene:panelId},init:()=>{globalThis.process={env:{}};if(new URLSearchParams(location.search).get('scene')==='terminal')history.replaceState(null,'',location.href+'#key=synthetic-public-key');window.addEventListener('error',e=>{window.__CAPTURE_ERROR__=e.error?.stack||e.message;});}});
   try {
    await page.waitForTimeout(650);
    if(panelId==='friend-search'){await page.locator('input').first().fill('review');await page.waitForTimeout(800);}
    if(panelId==='terminal'||panelId==='terminal-confirm')await page.getByText('Connect Terminal',{exact:true}).waitFor();
    if(panelId==='credentials')await page.getByText('Review account',{exact:true}).waitFor();
    if(panelId==='artifact-new'){const boxes=page.getByRole('textbox');await boxes.nth(0).fill('Review checklist');await boxes.nth(1).fill('Check warm light and dark surfaces.\nVerify desktop and mobile typography.');}
    await capture.capture(page,{panelId,label,sourcePaths:paths,state:panelId==='terminal-invalid'?'invalid-link':panelId==='terminal-confirm'?'confirmation':'populated',limitations:[...(panelId==='usage'?[usageChartLimitation]:[]),'Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.',...(panelId==='claude'?['Web manual OAuth setup only; native OAuthView WebView is not mounted on Web.']:panelId==='account-key'||panelId==='account'?['The displayed all-zero key is synthetic and has no account access.']:[])]});console.log('CAPTURE',panelId,theme,viewport.width);
    if(['account','agents','appearance','features','machine','session-info','voice','settings','credentials','usage'].includes(panelId)){
     const scrolled=await page.evaluate(()=>{const candidates=[...document.querySelectorAll('#root div')].filter(el=>['auto','scroll'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+30);const target=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0];if(!target)return false;target.scrollTop=target.scrollHeight;return true;});
     if(scrolled){await page.waitForTimeout(200);await capture.capture(page,{panelId,label,sourcePaths:paths,state:'scrolled-bottom',limitations:[...(panelId==='usage'?[usageChartLimitation]:[]),'Scrolled to the bottom using the existing production overflow container.','Synthetic service data; native navigation header is outside this fixture.']});}
    }
   } catch(error){console.error('FAILED',panelId,theme,viewport.width,error,await page.evaluate(()=>window.__CAPTURE_ERROR__));failures.push({panelId,theme,viewport,error:String(error)});} finally {await page.close();}
  }
 }
} finally {await capture.close();writeFileSync(resolve(capture.directory,'gaps.json'),JSON.stringify([{sourcePath:'components/OAuthView.tsx',status:'unproved',reason:'The native-only OAuth WebView is not mounted by the Web Claude route. No installed iOS/Android provider-auth host is available. The Web manual setup route is captured without claiming OAuthView coverage.'},{surface:'installed native',status:'unproved',reason:'All artifacts here use React Native Web. Native font/layout/device behavior and system integrations require installed-device acceptance.'}],null,2)+'\n');writeFileSync(resolve(capture.directory,'capture-failures.json'),JSON.stringify(failures,null,2)+'\n');}
const recorded=new Set(capture.manifest.map(item=>item.filename));
for(const name of readdirSync(capture.directory))if(name.endsWith('.png')&&!recorded.has(name))unlinkSync(resolve(capture.directory,name));
if(failures.length)process.exitCode=1;
