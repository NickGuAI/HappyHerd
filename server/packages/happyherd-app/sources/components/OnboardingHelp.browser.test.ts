import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

import en from '@/text/locales/en.json';
import cn from '@/text/locales/cn.json';
import de from '@/text/locales/de.json';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const sourceRoot = resolve(appRoot, 'sources');
const modules: Record<string, string> = {
    'react-native': `export * from 'react-native-web';`,
    'react-native-unistyles': `
        import { lightTheme, darkTheme } from '@/theme';
        export const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
        export const useUnistyles = () => ({ theme }); export const withUnistyles=Component=>Component;
        export const StyleSheet = { create: (factory) => typeof factory === 'function' ? factory(theme,{}) : factory };
    `,
    'react-native-safe-area-context': `export const useSafeAreaInsets = () => ({ top:0, right:0, bottom:0, left:0 });`,
    '@/utils/responsive': `export const useIsTablet = () => false; export const getDeviceType=()=> 'phone';`,
    '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop = () => null;`,
    // The real MobileGlassSurface takes this plain View branch on Web.
    // Native material effects are outside this Chromium fixture.
    '@/components/MobileGlass': `
        import React from 'react'; import { View } from 'react-native';
        export const MobileGlassSurface = ({children,style}) => React.createElement(View,{style},children);
    `,
    'fixture-unused-custom-modal': `export const CustomModal = () => null;`,
    '@/text': `import en from '@/text/locales/en.json'; import cn from '@/text/locales/cn.json'; import de from '@/text/locales/de.json'; export const t = (key,args={}) => { const catalog={en,cn,de}[new URLSearchParams(location.search).get('locale')||'en']; const value=key.split('.').reduce((v,k)=>v?.[k],catalog) ?? key; return typeof value==='string' ? value.replace(/\\{(\\w+)\\}/g,(_,k)=>args[k]??'{'+k+'}') : value; };`,
    'fixture-native': `import React from 'react'; import {Pressable as WebPressable} from 'react-native-web'; export const Pressable=({accessibilityState,...props})=><WebPressable {...props} aria-checked={accessibilityState?.checked}/>; export * from 'react-native-web'; import {Platform as WebPlatform} from 'react-native-web'; export const Platform={...WebPlatform, OS:new URLSearchParams(location.search).has('native')?'ios':'web',select:values=>values[new URLSearchParams(location.search).has('native')?'ios':'web']??values.default};`,
    '@expo/vector-icons': `import React from 'react'; import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'; export const Ionicons=({name,size,color})=><span aria-hidden="true" style={{fontFamily:'ionicons',fontSize:size,color,lineHeight:1}}>{String.fromCodePoint(glyphs[name])}</span>;`,
    'expo-image': `import React from 'react'; import {Image as NativeImage} from 'react-native-web'; export const Image=({contentFit,...props})=><NativeImage {...props} resizeMode={contentFit}/>;`,
    'expo-router': `export const useRouter=()=>({navigate:path=>window.__NAVIGATION__=path,push:path=>window.__NAVIGATION__=path,dismissTo:path=>window.__NAVIGATION__=path});`,
    '@expo/clipboard': `export const setStringAsync=async text=>{window.__CLIPBOARD__=text};`,
    'expo-clipboard': `export const setStringAsync=async text=>{window.__CLIPBOARD__=text};`,
    '@/sync/storage': `import React from 'react'; const machines=new URLSearchParams(location.search).has('offline')?[{id:'fixture-machine',name:'Laptop',online:false,metadata:{host:'fixture-host',path:'/fixture'}}]:[]; export const useAllMachines=()=>machines; export const useSessions=()=>[]; export const useSettingMutable=()=>[true,()=>{}]; let localSettings={linkComputerChecklist:JSON.parse(localStorage.getItem('linkComputerChecklist')||'{}')}; const listeners=new Set(); export const storage={getState:()=>({localSettings,applyLocalSettings:patch=>{localSettings={...localSettings,...patch};localStorage.setItem('linkComputerChecklist',JSON.stringify(localSettings.linkComputerChecklist));listeners.forEach(fn=>fn())}})}; export const useLocalSetting=key=>React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>localSettings[key]);`,
    '@/sync/machineChoices': `export const collectMachineChoices=machines=>machines;`,
    '@/hooks/useVisibleSessionListViewData': `export const useVisibleSessionListViewData=()=>[]; export const useHasArchivedSessions=()=>false;`,
    '@/components/SessionsList': `export const SessionsList=()=>null;`,
    '@/hooks/useConnectTerminal': `export const useConnectTerminal=()=>({connectTerminal:()=>{},connectWithUrl:()=>{},isLoading:false});`,
    '@/utils/openExternalUrl': `export const openExternalUrl=async url=>{if(window.__FAIL_EXTERNAL__)throw Error('fixture external navigation failure');window.__EXTERNAL_URLS__.push(url);return true;};`,
    '@/auth/AuthContext': `export const useAuth=()=>({login:async()=>{throw Error('Authentication must not run in help journey')}});`,
    '@/auth/authQRStart': `export const generateAuthKeyPair=()=>({publicKey:new Uint8Array(32),secretKey:new Uint8Array(32)}); export const authQRStart=async()=>true;`,
    '@/auth/authQRWait': `export const authQRWait=()=>new Promise(()=>{});`,
    '@/auth/authGetToken': `export const authGetToken=async()=>{throw Error('Authentication must not run in help journey')};`,

};
const plugin: Plugin = {
    name: 'production-onboarding-help-fixture',
    setup(bundle) {
        bundle.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === 'react-native' && args.importer.endsWith('/EmptyMainScreen.tsx')) return {path:'fixture-native',namespace:'boundary'};
            if (args.path === './components/CustomModal' && args.importer.endsWith('/modal/ModalProvider.tsx')) {
                return { path: 'fixture-unused-custom-modal', namespace: 'boundary' };
            }
            const normalized = args.path.startsWith('.') && args.resolveDir.startsWith(sourceRoot) ? `@/${relative(sourceRoot, resolve(args.resolveDir, args.path))}` : args.path;
            if (Object.hasOwn(modules, normalized)) return { path: normalized, namespace: 'boundary' };
            if (args.path.startsWith('@/')) {
                const base = resolve(sourceRoot, args.path.slice(2));
                const path = [base, `${base}.web.tsx`, `${base}.tsx`, `${base}.web.ts`, `${base}.ts`, `${base}.json`, `${base}/index.ts`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
                if (!path) throw new Error(`Missing onboarding fixture import: ${args.path}`);
                return { path };
            }
            return null;
        });
        bundle.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => ({ contents: modules[args.path], loader: 'tsx', resolveDir: here }));
    },
};
const fixture = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ModalProvider} from '@/modal/ModalProvider';
    import {SessionsListWrapper} from '@/components/SessionsListWrapper';
    import Restore from '@/app/(app)/restore/index';
    import Manual from '@/app/(app)/restore/manual';
    import {theme} from 'react-native-unistyles';
    window.__EXTERNAL_URLS__=[];
    document.body.style.background=theme.colors.surface;
    const route=new URLSearchParams(location.search).get('route');
    const root=createRoot(document.getElementById('root'));
    const render=key=>root.render(<ModalProvider key={key}>{route==='qr'?<Restore/>:route==='manual'?<Manual/>:<SessionsListWrapper/>}</ModalProvider>);
    window.__REMOUNT__=()=>render(Date.now()); render(0);
`;

// Production controls, routes, and Web modal host. Auth/network, device linking,
// clipboard, external navigation and the local persistence adapter are synthetic.
// The native checklist selects only EmptyMainScreen's native branch in Chromium;
// it does not claim native OS alert, camera, storage, safe-area or device proof.
describe('Group 1 production onboarding and restore help journeys', () => {
    let browser: Browser;
    let server: Server;
    let origin: string;
    beforeAll(async () => {
        const bundle = await build({
            stdin: {contents: fixture, loader:'tsx', resolveDir:here},
            bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
            define:{__DEV__:'false','process.env.NODE_ENV':'"test"','process.env.EXPO_OS':'"web"','process.env.EXPO_PUBLIC_HAPPYHERD_ISSUE_URL':'"https://github.com/NickGuAI/HappyHerd/issues"','process.env':'{}'},
            resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.json'],
            loader:{'.js':'jsx','.webp':'dataurl','.png':'dataurl'}, plugins:[plugin],
        });
        const fonts = ['SpaceGrotesk-Regular','SpaceGrotesk-SemiBold','JetBrainsMono-Regular'].map(font=>`@font-face{font-family:'${font}';src:url(data:font/ttf;base64,${readFileSync(resolve(sourceRoot,'assets/fonts',font+'.ttf')).toString('base64')})}`).join('');
        const icons = readFileSync(resolve(appRoot,'../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')).toString('base64');
        server=createServer((_request,response)=>{
            response.setHeader('content-type','text/html; charset=utf-8');
            response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}@font-face{font-family:ionicons;src:url(data:font/ttf;base64,${icons})}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><style>${readFileSync(resolve(sourceRoot,'theme.css'),'utf8')}</style><main id="root"></main><script>globalThis.global=globalThis;${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`);
        });
        await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
        const address=server.address(); if (!address || typeof address==='string') throw Error('Group 1 fixture did not bind');
        origin=`http://127.0.0.1:${address.port}`;
        const executablePath=process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
        browser=await chromium.launch({...executablePath?{executablePath}:{channel:'chrome'},headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
    },60_000);
    afterAll(async()=>{await browser?.close(); if(server) await new Promise<void>(done=>server.close(()=>done()));});

    for (const viewport of [{width:1440,height:900},{width:390,height:844}]) for(const theme of ['light','dark']) for(const locale of ['en','cn','de'] as const) {
        const catalog={en,cn,de}[locale];
        it(`${locale} ${viewport.width} ${theme}: first-run and both restore routes expose Help through the production modal`,async()=>{
            const page=await browser.newPage({viewport}); page.setDefaultTimeout(5_000);
            const errors:string[]=[]; page.on('pageerror',error=>{errors.push(error.message);console.error('Group1 fixture page error:',error.message)});
            page.on('dialog',dialog=>{errors.push('Unexpected native browser dialog');void dialog.dismiss();});
            try {
                for(const route of ['first','qr','manual']) {
                    await page.goto(`${origin}/?theme=${theme}&locale=${locale}&route=${route}`);
                    const help=page.getByRole('button',{name:catalog.components.onboardingHelp.action,exact:true});
                    await help.click(); await page.getByRole('dialog').waitFor();
                    const message=route==='first'?catalog.components.onboardingHelp.linkMessage:catalog.components.onboardingHelp.restoreMessage;
                    await page.getByText(message,{exact:true}).waitFor();
                    expect(await page.getByRole('dialog').count()).toBe(1);
                    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
                    const evidence=process.env.HAPPYHERD_GROUP1_SCREENSHOTS;
                    if(evidence && locale==='de') {mkdirSync(evidence,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(evidence,`help-${route}-${locale}-${viewport.width}-${theme}.png`)});}
                    await page.getByRole('button',{name:catalog.common.cancel,exact:true}).click();
                    await page.getByRole('dialog').waitFor({state:'detached'});
                    expect(await page.evaluate(()=>(window as any).__EXTERNAL_URLS__)).toEqual([]);
                    await help.click();await page.getByRole('dialog').waitFor();
                    await page.getByRole('button',{name:catalog.settings.reportIssue,exact:true}).click();
                    await page.getByRole('dialog').waitFor({state:'detached'});
                    expect(await page.evaluate(()=>(window as any).__EXTERNAL_URLS__)).toEqual(['https://github.com/NickGuAI/HappyHerd/issues']);
                    if(route==='first') {
                        expect(await page.getByRole('checkbox').count()).toBe(0);
                        await page.evaluate(()=>{(window as any).__FAIL_EXTERNAL__=true;});
                        await help.click();await page.getByRole('dialog').waitFor();
                        await page.getByRole('button',{name:catalog.settings.reportIssue,exact:true}).click();
                        await page.getByText(catalog.happyHerd.automations.unknownError,{exact:true}).waitFor();
                        await page.getByRole('button',{name:'OK',exact:true}).click();
                        await page.getByRole('dialog').waitFor({state:'detached'});
                        await page.evaluate(()=>{(window as any).__FAIL_EXTERNAL__=false;});
                        await help.click();await page.getByRole('dialog').waitFor();
                        await page.getByRole('button',{name:catalog.settings.reportIssue,exact:true}).click();
                        await page.getByRole('dialog').waitFor({state:'detached'});
                        expect(await page.evaluate(()=>(window as any).__EXTERNAL_URLS__)).toEqual(Array(2).fill('https://github.com/NickGuAI/HappyHerd/issues'));
                    }
                }
                expect(errors).toEqual([]);
            } finally {await page.close();}
        },30_000);
        it(`${locale} ${viewport.width} ${theme}: emulated native checklist toggles independently and persists through remount/reload; offline troubleshooting remains`,async()=>{
            const page=await browser.newPage({viewport});page.setDefaultTimeout(5_000);
            const errors:string[]=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Group1 fixture page error:',error.message)});
            try {
                await page.goto(`${origin}/?theme=${theme}&locale=${locale}&native=1`);
                const install=page.getByRole('checkbox',{name:catalog.components.emptyMainScreen.installCli,exact:true});
                const open=page.getByRole('checkbox',{name:catalog.components.emptyMainScreen.runIt,exact:true});
                await install.waitFor();expect(await install.getAttribute('aria-checked')).toBe('false');expect(await open.getAttribute('aria-checked')).toBe('false');
                await install.click();expect(await install.getAttribute('aria-checked')).toBe('true');expect(await open.getAttribute('aria-checked')).toBe('false');
                await page.evaluate(()=>(window as any).__REMOUNT__());
                await expect.poll(()=>install.getAttribute('aria-checked')).toBe('true');expect(await open.getAttribute('aria-checked')).toBe('false');
                await open.click();await install.click();
                expect(await install.getAttribute('aria-checked')).toBe('false');expect(await open.getAttribute('aria-checked')).toBe('true');
                await page.reload();await open.waitFor();expect(await install.getAttribute('aria-checked')).toBe('false');expect(await open.getAttribute('aria-checked')).toBe('true');
                expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('linkComputerChecklist')!))).toEqual({install:false,open:true});
                const evidence=process.env.HAPPYHERD_GROUP1_SCREENSHOTS;
                if(evidence && locale==='de') {mkdirSync(evidence,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(evidence,`checklist-emulated-ios-${locale}-${viewport.width}-${theme}.png`)});}
                await page.goto(`${origin}/?theme=${theme}&locale=${locale}&offline=1`);
                expect(await page.getByRole('checkbox').count()).toBe(0);
                expect(await page.getByRole('button',{name:catalog.components.onboardingHelp.action,exact:true}).count()).toBe(0);
                await page.getByRole('button',{name:catalog.components.emptyMainScreen.troubleshoot,exact:true}).click();await page.getByRole('dialog').waitFor();
                await page.getByText(catalog.components.emptyMainScreen.troubleshootConnection,{exact:true}).waitFor();
                expect(await page.getByRole('dialog').innerText()).toContain('Laptop');
                await page.getByRole('button',{name:catalog.components.emptyMainScreen.copyAiPrompt,exact:true}).click();
                await page.getByRole('dialog').waitFor({state:'detached'});
                expect(await page.evaluate(()=>(window as any).__CLIPBOARD__)).toContain('Laptop');
                expect(errors).toEqual([]);
            } finally {await page.close();}
        },30_000);
    }
});
