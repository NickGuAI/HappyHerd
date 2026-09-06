import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const appRoot = process.cwd();
const patch = ['--- a/src/example.ts', '+++ b/src/example.ts', '@@ -10 +10 @@', '-const oldValue = 1;', '+const newValue = 2;'].join('\n');
const fullPatch = ['--- a/src/example.ts', '+++ b/src/example.ts', '@@ -1,2 +1,2 @@', ' // full context', '-const oldValue = 1;', '+const newValue = 2;'].join('\n');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';

// Keep the production list, header, renderer, horizontal scroll owner, engine,
// tool card and mobile typography. Substitute only runtime state and transport.
const modules: Record<string, string> = {
    'react-native-unistyles': `
        import { lightTheme } from '@/theme';
        export const useUnistyles = () => ({ theme: lightTheme });
        export const StyleSheet = { hairlineWidth: 1, create: (v) => typeof v === 'function' ? v(lightTheme) : v };
    `,
    '@expo/vector-icons': `
        import React from 'react';
        export const Ionicons = ({name}) => React.createElement('span', {'data-icon': name});
        export const Octicons = Ionicons;
    `,
    '@/components/FileIcon': `export const FileIcon = () => null;`,
    '@/constants/Typography': `export const Typography = {default: () => ({}), mono: () => ({fontFamily: 'monospace'})};`,
    '@/text': `import en from '@/text/locales/en.json'; export const t = (key, args) => {
        const value = key.split('.').reduce((node, part) => node?.[part], en) ?? key;
        return typeof value === 'string' ? value.replace(/\\{(\\w+)\\}/g, (_, part) => String(args?.[part] ?? '')) : key;
    };`,
    'expo-image': `import React from 'react'; export const Image = ({source, style}) => React.createElement('img', {src:source.uri, style, alt:''});`,
    'expo-router': `export const useRouter = () => ({push: (path) => {window.__NAVIGATION__ = path;}});`,
    '@/sync/storage': `
        import React from 'react';
        const settings = {diffStyle: 'unified', showLineNumbersInToolViews: true, wrapLinesInDiffs: false};
        const listeners = new Set();
        const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
        export const useSetting = (key) => React.useSyncExternalStore(subscribe, () => settings[key]);
        export const useSettingMutable = (key) => [useSetting(key), React.useCallback((value) => { settings[key] = value; listeners.forEach((cb) => cb()); }, [key])];
        const file = (fullPath) => ({fullPath, status:'modified', isStaged:false, linesAdded:1, linesRemoved:1});
        const files = {stagedFiles: [], unstagedFiles:[file('src/example.ts'), file('assets/pixel.png')]};
        export const useSessionGitStatusFiles = () => files;
        export const storage = {getState: () => ({sessions:{demo:{metadata:{path:'/workspace', machineId:'machine'}}},machines:{machine:{metadata:{platform:'linux'}}}})};
    `,
    '@/sync/ops': `
        window.__COMMANDS__ = [];
        export const sessionBash = async (_, request) => {
            window.__COMMANDS__.push(request.command);
            if (request.command.startsWith('node ')) return {success:true, stdout:${JSON.stringify(pixel)}};
            await new Promise((done) => setTimeout(done, new URLSearchParams(location.search).has('slow') ? 120 : 10));
            return {success:true,stdout:request.command.includes('-U100000') ? ${JSON.stringify(fullPatch)} : ${JSON.stringify(patch)}};
        };
        export const sessionReadFile = async () => ({success:true,content:${JSON.stringify(pixel)}});
    `,
};

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AllFilesDiffView} from '@/components/AllFilesDiffView';
import {CodexPatchView, CodexPatchViewFull} from '@/components/tools/views/CodexPatchView';
import {MobileTypographyFloor} from '@/components/MobileTypographyFloor';
function Fixture() {
    const [header, setHeader] = React.useState(null);
    const params = new URLSearchParams(location.search);
    const changes = {'src/100% ready.ts':{type:'add',diff:'const value = 42;'},'src/other.ts':{type:'delete',diff:'const removed = true;'}};
    const tool = {input:{changes},name:'CodexPatch'};
    if (params.has('tool')) return <><CodexPatchView tool={tool} metadata={null} sessionId="demo" messageId="edit" /><CodexPatchViewFull tool={tool} metadata={null} focusFile="src/100% ready.ts" /></>;
    return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}>
        <MobileTypographyFloor active={innerWidth < 600}>{null}</MobileTypographyFloor>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{header}</div>
        <AllFilesDiffView sessionId="demo" scrollToFile={params.has('focus') ? 'src/example.ts' : null} onHeaderRightSlotChange={setHeader}/>
    </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

let server: Server;
let browser: Browser;
let origin: string;
describe('production diff journeys', () => {
    beforeAll(async () => {
        const bundle = await build({
            stdin: {contents: fixture, resolveDir: appRoot, loader:'tsx'},
            bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
            resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.js','.json'],
            alias:{'react-native':'react-native-web'},
            define:{'process.env.NODE_ENV':'"test"','__DEV__':'false','global':'globalThis'},
            plugins:[{name:'runtime-boundaries',setup(ctx){
                ctx.onResolve({filter:/.*/}, ({path}) => {
                    if (path in modules) return {path,namespace:'boundary'};
                    if (path.startsWith('@/')) {
                        const base=resolve(appRoot,'sources',path.slice(2));
                        const found=[base+'.web.tsx',base,base+'.ts',base+'.tsx'].find(existsSync);
                        if (found) return {path:found};
                    }
                });
                ctx.onLoad({filter:/.*/,namespace:'boundary'},({path})=>({contents:modules[path],loader:'tsx',resolveDir:appRoot}));
            }}],
        });
        server=createServer((req,res)=>{
            if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
            res.setHeader('content-type','text/html');
            res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;}*{box-sizing:border-box}</style><main id="root"></main><script src="/bundle.js"></script>');
        });
        await new Promise<void>((done)=>server.listen(0,'127.0.0.1',done));
        const address=server.address();
        if(!address || typeof address==='string')throw new Error('No fixture port');
        origin='http://127.0.0.1:'+address.port;
        browser=await chromium.launch({...(process.env.HAPPYHERD_BROWSER_EXECUTABLE ? {executablePath:process.env.HAPPYHERD_BROWSER_EXECUTABLE} : {channel:'chrome'}),headless:true,args:['--no-sandbox']});
    },30_000);
    afterAll(async()=>{await browser?.close();if(server)await new Promise<void>((done)=>server.close(()=>done()));});

    for (const width of [1440,390]) {
        it(`collapses, expands, refreshes context, switches layout and renders images at ${width}px`,async()=>{
            const page=await browser.newPage({viewport:{width,height:width===390?844:900},hasTouch:width===390});
            const errors:string[]=[];page.on('pageerror',(e)=>{errors.push(e.message);console.error(e.message);});
            page.setDefaultTimeout(5000);
            await page.goto(origin);
            const file=page.getByRole('button',{name:'src/example.ts',exact:true});
            await file.waitFor({state:'attached'});
            await file.waitFor();
            expect(await file.getAttribute('aria-expanded')).toBe('false');
            expect(await page.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
            await file.click();
            await page.getByText('newValue',{exact:false}).first().waitFor();
            const keyword=page.getByText('const',{exact:true}).first();
            expect(await keyword.evaluate((el)=>getComputedStyle(el).color)).toBe('rgb(207, 34, 46)');
            await page.getByRole('checkbox').click();
            await page.waitForFunction(()=> (window as any).__COMMANDS__.some((c:string)=>c.includes(' -w ')));
            await page.getByText(/9 unchanged|9.*lines|diff\.unchangedLines/).first().click();
            await page.getByText('// full context',{exact:true}).first().waitFor();
            await page.getByText('Split',{exact:true}).click();
            await page.getByText('newValue',{exact:false}).first().waitFor();
            await page.getByRole('button',{name:'assets/pixel.png',exact:true}).click();
            await page.locator('img').first().waitFor();
            expect(await page.locator('img').count()).toBe(2);
            await page.waitForFunction(()=>Array.from(document.images).every((img)=>img.complete && img.naturalWidth>0));
            if(width===390) expect(await keyword.evaluate((el)=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            expect(errors).toEqual([]);
            await page.close();
        },20_000);
        it(`opens a focused file and replaces cancelled whitespace fetches at ${width}px`,async()=>{
            const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
            page.setDefaultTimeout(5000);
            page.on('pageerror',(e)=>console.error(e.message));
            await page.goto(origin+'/?focus&slow');
            await page.getByRole('checkbox').click();
            await page.getByText('newValue',{exact:false}).first().waitFor();
            expect(await page.getByRole('button',{name:'src/example.ts',exact:true}).getAttribute('aria-expanded')).toBe('true');
            expect(await page.evaluate(()=>(window as any).__COMMANDS__.filter((c:string)=>c.includes(' -w ')).length)).toBeGreaterThan(0);
            await page.close();
        },20_000);
        it(`opens an individual tool file without a second collapse at ${width}px`,async()=>{
            const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
            page.setDefaultTimeout(5000);
            page.on('pageerror',(e)=>console.error(e.message));
            await page.goto(origin+'/?tool');
            const file=page.getByRole('button',{name:'src/100% ready.ts',exact:true});
            await file.click();
            expect(await page.evaluate(()=>(window as any).__NAVIGATION__)).toBe('/session/demo/message/edit?file=src%2F100%25%20ready.ts');
            expect(await page.getByText('removed',{exact:false}).count()).toBe(1);
            expect(await page.getByText('value',{exact:false}).count()).toBe(2);
            expect(await page.getByText('value',{exact:false}).first().evaluate((el)=>getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
            await page.close();
        },20_000);
    }
});
