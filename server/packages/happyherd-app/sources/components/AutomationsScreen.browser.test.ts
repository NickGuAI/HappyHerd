import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Real Automations route, detail, collapse and controls; isolated machine/RPC
// state and platform adapters. This is rendered interaction, not live evidence.
const modules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'react-native-unistyles': `import { lightTheme as theme } from '@/theme'; export const StyleSheet={create:f=>typeof f==='function'?f(theme,{}):f,hairlineWidth:1}; export const useUnistyles=()=>({theme});`,
    '@expo/vector-icons': `import React from 'react'; export const Ionicons=()=>React.createElement('span');`,
    'react-native-reanimated': `import React from 'react'; import {View} from 'react-native'; export default {View:({style,...p})=>React.createElement(View,p)}; export const Easing={bezier:()=>x=>x}; export const ReduceMotion={System:'system'}; export const useAnimatedStyle=f=>f(); export const useSharedValue=v=>React.useRef({value:v}).current; export const withTiming=(v,c,f)=>{f?.(true);return v;};`,
    'react-native-worklets': `export const runOnJS=f=>f;`,
    'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,right:0,bottom:0,left:0});`,
    '@react-navigation/native': `import React from 'react'; export const useFocusEffect=f=>React.useEffect(f,[f]);`,
    'expo-router': `export const useLocalSearchParams=()=>({}); export const Stack={Screen:()=>null};`,
    '@/components/StyledText': `export {Text} from 'react-native';`,
    '@/constants/Typography': `export const Typography={default:()=>({}),mono:()=>({})};`,
    '@/components/markdown/MarkdownView': `import React from 'react'; import {Text} from 'react-native'; export const MarkdownView=({markdown})=>React.createElement(Text,null,markdown);`,
    '@/hooks/useNavigateToSession': `const navigate=id=>globalThis.calls.push({sessionId:id}); export const useNavigateToSession=()=>navigate;`,
    '@/sync/storage': `export const useAllMachines=()=>globalThis.machines;`,
    '@/modal': `export const Modal={confirm:async(title,message)=>confirm(title+' '+message),alert:(title,message)=>alert(title+' '+message)};`,
    '@/text': `import catalog from '@/text/locales/en.json'; export const getCurrentLanguage=()=> 'en'; export const t=(key,p={})=>{let s=key.split('.').reduce((v,k)=>v?.[k],catalog)??key;if(s.select)s=s.select.cases[p[s.select.param]===1?'one':'other'];return Object.entries(p).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)),s);};`,
    '@/sync/ops': `
        export const machineListAutomations=async()=>({definitionSchemaVersion:4,automations:[globalThis.automation],blockedRuns:globalThis.blocked?[globalThis.blocker]:[]});
        export const machineListCommanders=async()=>({commanders:[]});
        export const machineAutomationHistory=async()=>({runs:[]});
        export const machineAbandonAutomationRun=async(machineId,input)=>{globalThis.calls.push({machineId,...input});globalThis.blocked=false;return {};};
        export const machineStopAutomationRun=async()=>{if(globalThis.stopSucceeds)return {};throw new Error('Run is no longer tracked');};
        export const machineCreateAutomation=async()=>{}; export const machineDeleteAutomation=async()=>{};
        export const machinePauseAutomation=async()=>{}; export const machineResumeAutomation=async()=>{};
        export const machineRunAutomationNow=async()=>{}; export const machineUpdateAutomation=async()=>{};
    `,
};
const plugin: Plugin = { name: 'automation-browser-state', setup(bundle) {
    bundle.onResolve({filter:/.*/}, args => {
        if(args.path in modules)return {path:args.path,namespace:'fixture'};
        if(args.path.startsWith('@/')) {
            const source=resolve(appRoot,'sources',args.path.slice(2));
            const path=[source,`${source}.ts`,`${source}.tsx`,`${source}.web.tsx`,`${source}.json`].find(existsSync);
            if(path)return {path};
        }
        return null;
    });
    bundle.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'tsx',resolveDir:appRoot}));
}};
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import AutomationsScreen from '@/app/(app)/automations/index';
globalThis.calls=[];globalThis.blocked=true;
globalThis.machines=[{id:'machine-a',active:true,activeAt:Date.now(),metadata:{host:'test-machine'}}];
globalThis.automation={schemaVersion:4,runtimeOwner:'happyherd',id:'11111111-1111-4111-8111-111111111111',machineId:'machine-a',name:'Blocked job',kind:'scheduled',instruction:'Review work.',schedule:'0 8 * * *',timezone:'UTC',workspace:'/srv',rail:'codex',commanderId:null,status:'active',maxRetries:0,tags:[],createdAt:'2026-09-29T00:00:00.000Z',updatedAt:'2026-09-29T00:00:00.000Z',lastScheduledAt:null,lastRunAt:null};
globalThis.blocker={automationId:globalThis.automation.id,runId:'22222222-2222-4222-8222-222222222222',sessionId:'session-blocker',consecutiveSkippedRuns:3,blockedAt:'2026-09-29T01:00:00.000Z'};
createRoot(document.getElementById('root')).render(React.createElement(AutomationsScreen));
`;

describe('Automations blocked recovery in browser', () => {
    let server: Server; let browser: Browser; let origin: string;
    beforeAll(async()=>{
        const output=await build({stdin:{contents:entry,loader:'tsx',resolveDir:appRoot},bundle:true,write:false,platform:'browser',format:'iife',plugins:[plugin],define:{'process.env.NODE_ENV':'"test"',__DEV__:'false'},loader:{'.ttf':'dataurl','.png':'dataurl'}});
        server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(`<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script>globalThis.global=globalThis;${output.outputFiles[0].text}</script>`);});
        await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
        const address=server.address();if(!address||typeof address==='string')throw new Error('bind failed');origin=`http://127.0.0.1:${address.port}`;
        browser=await chromium.launch({...(process.env.HAPPYHERD_BROWSER_EXECUTABLE?{executablePath:process.env.HAPPYHERD_BROWSER_EXECUTABLE}:{channel:'chrome'}),headless:true});
    },30_000);
    afterAll(async()=>{await browser?.close();if(server)await new Promise<void>(done=>server.close(()=>done()));});
    for(const width of [1440,390])it(`opens the blocked row and recovers the exact run at ${width}px`,async()=>{
        const page=await browser.newPage({viewport:{width,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'/automations');
        await page.getByText('Blocked',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Show details for Blocked job'}).click();
        await page.getByText('Run 22222222-2222-4222-8222-222222222222 is blocking this automation after 3 consecutive scheduled skips.',{exact:true}).waitFor();
        page.once('dialog',dialog=>dialog.dismiss());
        await page.getByRole('button',{name:'Abandon run',exact:true}).click();
        expect(await page.evaluate(()=>(globalThis as any).calls)).toEqual([]);
        page.once('dialog',dialog=>dialog.accept());
        await page.getByRole('button',{name:'Stop run',exact:true}).click();
        await page.getByText('Blocked',{exact:true}).waitFor();
        await page.evaluate(() => { (globalThis as any).stopSucceeds = true; });
        await page.getByRole('button',{name:'Stop run',exact:true}).click();
        await page.getByText('Stop requested. The run remains blocked until its process exits. Refresh status to check.', {exact:true}).waitFor();
        await page.getByRole('button',{name:'Refresh status',exact:true}).click();
        await page.getByText('Blocked',{exact:true}).waitFor();
        page.once('dialog',dialog=>dialog.accept());
        await page.getByRole('button',{name:'Abandon run',exact:true}).click();
        await page.getByText('Active',{exact:true}).waitFor();
        expect(await page.evaluate(()=>(globalThis as any).calls)).toEqual([{machineId:'machine-a',automationId:'11111111-1111-4111-8111-111111111111',runId:'22222222-2222-4222-8222-222222222222',sessionId:'session-blocker',confirmation:'ABANDON'}]);
        expect(errors).toEqual([]);await page.close();
    },20_000);
});
