import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
    const virtual: Record<string, string> = {
        'react-native-unistyles': `const colors = { text:'#111', textSecondary:'#666', textLink:'#06c', textDestructive:'#c00', divider:'#ddd', surface:'#fff', surfaceSelected:'#eee', success:'#080', warning:'#a60', groupped:{background:'#fafafa'}, input:{background:'#f5f5f5'}, button:{primary:{background:'#111',tint:'#fff'}}, glass:{overlay:'#fff',backgroundStrong:'#fff',border:'#ddd',overlayTint:'#fff'}, shadow:{color:'#000'} }; const theme={colors}; export const StyleSheet={hairlineWidth:1, create: factory => typeof factory==='function'?factory(theme):factory}; export const useUnistyles=()=>({theme});`,
        '@expo/vector-icons': `import React from 'react'; import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'; import font from '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'; export const Ionicons=({name,size,color})=>React.createElement(React.Fragment,null,React.createElement('style',null,'@font-face{font-family:TestIonicons;src:url('+font+')}'),React.createElement('span',{'aria-hidden':true,style:{fontFamily:'TestIonicons',fontSize:size,lineHeight:1,color}},String.fromCodePoint(glyphs[name])));`,
        'expo-router': `export const Stack={Screen:()=>null}; export const useRouter=()=>({back(){window.fixture.backCount++},push(){}}); export const useLocalSearchParams=()=>({});`,
        'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,right:0,bottom:0,left:0});`,
        '@/components/CommandPalette/CommandPaletteModal': `export const CommandPaletteModal=()=>null;`,
        '@/components/CommandPalette': `export const CommandPalette=()=>null;`,
        '@/components/AnimatedOverlay': `export const AnimatedBlurBackdrop=()=>null;`,
        '@/components/MobileGlass': `import React from 'react';import {View} from 'react-native';export const MobileGlassSurface=({children,style})=>React.createElement(View,{style},children);`,
        '@/components/FileIcon': `import React from 'react';export const FileIcon=()=>React.createElement('span',{'aria-hidden':true},'▤');`,
        '@/components/StyledText': `export {Text} from 'react-native';`,
        '@/constants/Typography': `export const Typography={default:()=>({fontFamily:'sans-serif',fontSize:16}),mono:()=>({fontFamily:'monospace',fontSize:16})};`,
        '@/components/layout': `export const layout={maxWidth:1200};`,
        '@/components/FileViewPanel': `import React from 'react'; export function FileContentPanel({filePath,onDirtyChange,onHeaderRightSlotChange}) { const [value,setValue]=React.useState('Neutral file'); React.useEffect(()=>{setValue('Neutral file');onDirtyChange(false);return()=>{onDirtyChange(false);onHeaderRightSlotChange(null)}},[filePath]);return React.createElement('div',{'data-testid':'file-content','data-path':filePath},React.createElement('textarea',{'aria-label':'File contents',value,onChange:event=>{setValue(event.target.value);onDirtyChange(true)}})); }`,
        '@/components/WorkspaceLinkViewer': `export const WorkspaceLinkViewer=()=>null;`,
        '@/components/WorkspaceLinkViewerModel': `export const workspaceLinkViewerKey=()=>'';`,
        '@/-session/workspaceLinkNavigation': `export const dismissWorkspaceLinkToOrigin=()=>{};export const useWorkspaceLinkDismissGuard=()=>({guardDismiss:action=>action(),onDirtyChange:()=>{},onSendingChange:()=>{}});`,
        '@/hooks/useMachineFileUpload': `export const useMachineFileUpload=()=>({reset(){},pickAndUpload(){window.fixture.uploads++},cancel(){},retry(){},canCancel:false,canRetry:false,state:{phase:'idle'}});`,
        '@/components/MachineFileUploadStatus': `export const MachineFileUploadStatus=()=>null;`,
        '@/utils/sessionUtils': `export const formatPathRelativeToHome=path=>path;`,
        '@/sync/storage': `import React from 'react';const empty=[];export const useSetting=key=>key==='machineWorkspace'?true:empty;export const useAllMachines=()=>{React.useSyncExternalStore(listener=>{window.fixture.listeners.add(listener);return()=>window.fixture.listeners.delete(listener)},()=>window.fixture.revision);return window.fixture.machines;};export const storage={getState:()=>({settings:{recentMachinePaths:empty,favoriteMachinePaths:empty}})};`,
        '@/sync/sync': `export const sync={applySettings(){}};`,
        '@/text': `import en from './sources/text/locales/en.json';export const t=(key,params={})=>Object.entries(params).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),key.split('.').reduce((value,part)=>value?.[part],en)??key);`,
        '@/sync/ops': `export const machineGetDirectoryTree=async(machineId,path)=>{window.fixture.reads.push({machineId,path});const entries=window.fixture.files[machineId];return {success:true,tree:{type:'directory',name:path.split('/').pop(),path,children:entries.filter(item=>item.path.substring(0,item.path.lastIndexOf('/'))===path)}}};
            async function remove(machineId,path,type){window.fixture.deletes.push({machineId,path,type});const result=window.fixture.deleteMode==='pending'?await new Promise(resolve=>window.fixture.resolveDelete=resolve):window.fixture.deleteMode==='error'?{success:false,error:'EACCES: neutral fixture'}:{success:true};if(result.success)window.fixture.files[machineId]=window.fixture.files[machineId].filter(item=>item.path!==path && !(type==='directory'&&item.path.startsWith(path+'/')));return result;}
            export const machineDeleteFile=(machineId,path)=>remove(machineId,path,'file');export const machineDeleteDirectory=(machineId,path)=>remove(machineId,path,'directory');
            export const machineReadFile=async()=>({success:true,content:btoa('Neutral file')});export const machineWriteFile=async()=>({success:true});
            export const machineCreateDirectory=async(machineId,{directory,directoryName})=>{const path=directory+'/'+directoryName;window.fixture.created.push({machineId,path});window.fixture.files[machineId].push({type:'directory',name:directoryName,path});return {success:true,path};};`,
    };
    const bundle = await build({
        stdin: {
            resolveDir: appRoot, loader: 'tsx',
            contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {useWindowDimensions} from 'react-native';import {MachineWorkspaceBrowser} from './sources/app/(app)/workspace';import {ModalProvider} from './sources/modal';import {MobileTypographyFloor} from './sources/components/MobileTypographyFloor.web';import {getWorkspaceContextEntries,addWorkspaceContextEntry} from './sources/sync/workspaceContext';
                const sample=[{type:'file',name:'note.txt',path:'/workspace/note.txt',size:12},{type:'directory',name:'folder',path:'/workspace/folder'},{type:'file',name:'child.txt',path:'/workspace/folder/child.txt',size:12},{type:'directory',name:'folder-other',path:'/workspace/folder-other'}];
                window.fixture={files:{a:structuredClone(sample),b:structuredClone(sample)},machines:[{id:'a',active:true,activeAt:Date.now(),metadata:{host:'Machine A',homeDir:'/workspace',platform:'linux',supportsFileDelete:true,supportsDirectoryDelete:true}},{id:'b',active:true,activeAt:Date.now(),metadata:{host:'Machine B',homeDir:'/workspace',platform:'linux',supportsFileDelete:true,supportsDirectoryDelete:true}}],reads:[],deletes:[],deleted:[],created:[],uploads:0,backCount:0,deleteMode:'success',revision:0,listeners:new Set(),getContext:getWorkspaceContextEntries,addContext:addWorkspaceContextEntry};
                function Host(){const [initial,setInitial]=React.useState({initialMachineId:'a',initialPath:'/workspace'});window.fixture.setInitial=setInitial;const {width}=useWindowDimensions();const surface=new URLSearchParams(location.search).get('surface')||'standalone';return <MobileTypographyFloor active={width<600}><ModalProvider><MachineWorkspaceBrowser {...initial} embedded={surface!=='standalone'} workspaceContextSessionId={surface==='standalone'?undefined:surface} onDeleted={item=>window.fixture.deleted.push(item)} hasUnsavedChanges={item=>{window.fixture.dirtyTarget=item;return !!window.fixture.hasDirtyTabs;}} /></ModalProvider></MobileTypographyFloor>;}
                createRoot(document.getElementById('root')).render(<Host/>);`,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser',
        loader: { '.ttf': 'dataurl' },
        alias: { 'react-native': 'react-native-web' },
        tsconfig: resolve(appRoot, 'tsconfig.json'),
        define: { __DEV__: 'false' },
        plugins: [{ name: 'boundaries', setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (args.path === './ops' && args.importer.endsWith('/sync/workspaceContext.ts')) return { path: '@/sync/ops', namespace: 'boundary' };
                return virtual[args.path] ? { path: args.path, namespace: 'boundary' } : undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => ({ contents: virtual[args.path], loader: 'js', resolveDir: appRoot }));
        } }],
    });
    server = createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
        response.end(request.url === '/app.js' ? bundle.outputFiles[0].contents : '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;font:16px sans-serif}#root{display:flex}</style><div id="root"></div><script src="/app.js"></script>');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;
    const executablePath = process.env.HAPPYHERD_BROWSER_EXECUTABLE?.trim();
    browser = await chromium.launch({
        ...(executablePath ? { executablePath } : { channel: 'chrome' }),
        args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    });
}, 30000);

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise<void>((done) => server.close(() => done()));
});

async function open(surface = 'standalone', width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => { throw error; });
    await page.goto(`${origin}/?surface=${surface}`);
    await page.getByText('note.txt', { exact: true }).waitFor();
    return { context, page };
}

async function confirm(page: Page, action: 'Cancel' | 'Delete') {
    await page.getByText(action, { exact: true }).last().click();
}

describe('Workspace item deletion through the shared browser', () => {
    it.each(['standalone', 'main-chat', 'side-chat'].flatMap((surface) => [1440, 390].map((width) => ({ surface, width }))))('offers file/folder deletion and confirmation on $surface at $width', async ({ surface, width }) => {
        const { context, page } = await open(surface, width);
        try {
            const deleteButton = page.getByRole('button', { name: 'Delete note.txt', exact: true });
            const bounds = await deleteButton.boundingBox();
            expect(bounds?.width).toBeGreaterThanOrEqual(44);
            expect(bounds?.height).toBeGreaterThanOrEqual(44);
            expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
            if (process.env.HAPPYHERD_DELETE_EVIDENCE_DIR) await page.screenshot({ path: resolve(process.env.HAPPYHERD_DELETE_EVIDENCE_DIR, `${surface}-${width}-listing.png`) });
            await deleteButton.click();
            await page.getByText('Delete file?', { exact: true }).waitFor();
            expect(await page.getByText(/permanently remove \/workspace\/note.txt/).count()).toBe(1);
            await confirm(page, 'Cancel');
            expect(await page.evaluate(() => (window as any).fixture.deletes)).toEqual([]);
            await page.getByRole('button', { name: 'Delete note.txt', exact: true }).click();
            await confirm(page, 'Delete');
            await expect.poll(() => page.getByText('note.txt', { exact: true }).count()).toBe(0);
            await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
            await page.getByText('Delete folder?', { exact: true }).waitFor();
            expect(await page.getByText(/\/workspace\/folder and all its contents/).count()).toBe(1);
            await expect.poll(() => page.getByText('Delete folder?', { exact: true }).evaluate((element) => {
                for (let current: Element | null = element; current; current = current.parentElement) {
                    if (Number(getComputedStyle(current).opacity) < 0.99) return false;
                }
                return true;
            })).toBe(true);
            if (process.env.HAPPYHERD_DELETE_EVIDENCE_DIR) await page.screenshot({ path: resolve(process.env.HAPPYHERD_DELETE_EVIDENCE_DIR, `${surface}-${width}-confirm.png`) });
            await confirm(page, 'Delete');
            await expect.poll(() => page.getByText('folder', { exact: true }).count()).toBe(0);
            expect(await page.getByText('folder-other', { exact: true }).count()).toBe(1);
            expect(await page.evaluate(() => (window as any).fixture.deleted)).toEqual([{ machineId: 'a', path: '/workspace/note.txt', type: 'file', platform: 'linux' }, { machineId: 'a', path: '/workspace/folder', type: 'directory', platform: 'linux' }]);
            if (surface === 'side-chat' && width === 390) {
                await page.getByRole('button', { name: 'Delete folder-other', exact: true }).click();
                await confirm(page, 'Delete');
                await expect.poll(() => page.getByText('folder-other', { exact: true }).count()).toBe(0);
            }
            await page.getByText('Upload', { exact: true }).click();
            expect(await page.evaluate(() => (window as any).fixture.uploads)).toBe(1);
            await page.getByText('New Folder', { exact: true }).click();
            await page.getByPlaceholder('Folder name', { exact: true }).fill('created');
            await page.getByText('Create', { exact: true }).last().click();
            await expect.poll(() => page.evaluate(() => (window as any).fixture.created.length)).toBe(1);
        } finally { await context.close(); }
    }, 20000);

    it('retains the listing and references after a deletion error', async () => {
        const { context, page } = await open('side-chat', 390);
        try {
            await page.getByLabel('Attach folder to next message', { exact: true }).click();
            await page.evaluate(() => { (window as any).fixture.deleteMode = 'error'; });
            await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
            await confirm(page, 'Delete');
            await page.getByText('EACCES: neutral fixture', { exact: true }).waitFor();
            await page.getByText('OK', { exact: true }).last().click();
            expect(await page.getByText('folder', { exact: true }).count()).toBe(1);
            expect(await page.evaluate(() => (window as any).fixture.deleted)).toEqual([]);
            expect(await page.evaluate(() => (window as any).fixture.getContext('side-chat').map((item: any) => item.path))).toEqual(['/workspace/folder']);
        } finally { await context.close(); }
    });

    it('keeps a pending delete on its captured machine and retains a different current selection', async () => {
        const { context, page } = await open();
        try {
            await page.evaluate(() => { (window as any).fixture.deleteMode = 'pending'; });
            await page.getByRole('button', { name: 'Delete note.txt', exact: true }).click();
            await confirm(page, 'Delete');
            await expect.poll(() => page.evaluate(() => (window as any).fixture.deletes.length)).toBe(1);
            expect(await page.getByRole('button', { name: 'Delete folder', exact: true }).isDisabled()).toBe(true);
            await page.getByText('Machine B', { exact: true }).click();
            await page.getByText('note.txt', { exact: true }).click();
            await page.locator('[data-testid="file-content"]').waitFor();
            await page.evaluate(() => (window as any).fixture.resolveDelete({ success: true }));
            await expect.poll(() => page.evaluate(() => (window as any).fixture.deleted.length)).toBe(1);
            expect(await page.getByText('note.txt', { exact: true }).count()).toBeGreaterThan(0);
            expect(await page.locator('[data-testid="file-content"]').getAttribute('data-path')).toBe('/workspace/note.txt');
            expect(await page.evaluate(() => (window as any).fixture.deletes)).toEqual([{ machineId: 'a', path: '/workspace/note.txt', type: 'file' }]);
        } finally { await context.close(); }
    });

    it('includes affected unsaved edits in one confirmation and closes the deleted file', async () => {
        const { context, page } = await open();
        try {
            await page.getByText('folder', { exact: true }).click();
            await page.getByText('child.txt', { exact: true }).click();
            await page.getByLabel('File contents', { exact: true }).fill('Unsaved draft');
            // Host navigation can leave a file tab open; the external dirty-tab callback is tested by the integrated host.
            await page.getByRole('button', { name: 'Delete child.txt', exact: true }).click();
            await page.getByText('Delete file?', { exact: true }).waitFor();
            expect(await page.getByText(/Your current file edits have not been saved/).count()).toBe(1);
            await confirm(page, 'Cancel');
            expect(await page.getByLabel('File contents', { exact: true }).inputValue()).toBe('Unsaved draft');
            await page.getByRole('button', { name: 'Delete child.txt', exact: true }).click();
            await confirm(page, 'Delete');
            await expect.poll(() => page.locator('[data-testid="file-content"]').count()).toBe(0);
        } finally { await context.close(); }
    });
    it('offers deletion only for the online machine and advertised item type', async () => {
        const { context, page } = await open();
        try {
            await page.evaluate(() => {
                const fixture = (window as any).fixture;
                delete fixture.machines[0].metadata.supportsDirectoryDelete;
                fixture.revision++;
                fixture.listeners.forEach((listener: () => void) => listener());
            });
            await expect.poll(() => page.getByRole('button', { name: 'Delete folder', exact: true }).count()).toBe(0);
            expect(await page.getByRole('button', { name: 'Delete note.txt', exact: true }).count()).toBe(1);
            await page.evaluate(() => {
                const fixture = (window as any).fixture;
                delete fixture.machines[0].metadata.supportsFileDelete;
                fixture.revision++;
                fixture.listeners.forEach((listener: () => void) => listener());
            });
            await expect.poll(() => page.getByRole('button', { name: /^Delete / }).count()).toBe(0);
            await page.evaluate(() => {
                const fixture = (window as any).fixture;
                fixture.machines[0].active = false;
                fixture.revision++;
                fixture.listeners.forEach((listener: () => void) => listener());
            });
            await expect.poll(() => page.getByText('note.txt', { exact: true }).count()).toBe(0);
            expect(await page.evaluate(() => (window as any).fixture.deletes)).toEqual([]);
        } finally { await context.close(); }
    });

    it('does not dispatch when the captured machine goes offline during confirmation', async () => {
        const { context, page } = await open();
        try {
            await page.getByRole('button', { name: 'Delete note.txt', exact: true }).click();
            await page.getByText('Delete file?', { exact: true }).waitFor();
            await page.evaluate(() => {
                const fixture = (window as any).fixture;
                fixture.machines[0].active = false;
                fixture.revision++;
                fixture.listeners.forEach((listener: () => void) => listener());
            });
            await confirm(page, 'Delete');
            await page.getByText('Failed to delete the item.', { exact: true }).waitFor();
            expect(await page.evaluate(() => (window as any).fixture.deletes)).toEqual([]);
            expect(await page.evaluate(() => (window as any).fixture.deleted)).toEqual([]);
        } finally { await context.close(); }
    });

    it('keeps the confirmed path and leaves a later directory selection intact', async () => {
        const { context, page } = await open();
        try {
            await page.getByRole('button', { name: 'Delete note.txt', exact: true }).click();
            await page.getByText('Delete file?', { exact: true }).waitFor();
            await page.evaluate(() => (window as any).fixture.setInitial({ initialMachineId: 'a', initialPath: '/workspace/folder' }));
            await confirm(page, 'Delete');
            await expect.poll(() => page.evaluate(() => (window as any).fixture.deleted.length)).toBe(1);
            expect(await page.getByRole('button', { name: 'child.txt', exact: true }).count()).toBe(1);
            expect(await page.evaluate(() => (window as any).fixture.deletes)).toEqual([{ machineId: 'a', path: '/workspace/note.txt', type: 'file' }]);
        } finally { await context.close(); }
    });

    it('removes only owned same-machine context descendants after folder success', async () => {
        const { context, page } = await open('main-chat', 390);
        try {
            await page.evaluate(() => {
                const fixture = (window as any).fixture;
                for (const path of ['/workspace/folder', '/workspace/folder/child.txt', '/workspace/folder-other']) {
                    fixture.addContext('main-chat', { path, kind: path.endsWith('.txt') ? 'file' : 'directory', source: { kind: 'machine', machineId: 'a' } });
                }
                fixture.addContext('main-chat', { path: '/workspace/folder/child.txt', kind: 'file', source: { kind: 'machine', machineId: 'b' } });
                fixture.addContext('main-chat', { path: '/workspace/folder/legacy.txt', kind: 'file', source: { kind: 'session' } });
                fixture.hasDirtyTabs = true;
            });
            await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
            await page.getByText('Delete folder?', { exact: true }).waitFor();
            expect(await page.getByText(/Your current file edits have not been saved/).count()).toBe(1);
            expect(await page.evaluate(() => (window as any).fixture.dirtyTarget)).toEqual({ machineId: 'a', path: '/workspace/folder', type: 'directory', platform: 'linux' });
            await confirm(page, 'Delete');
            await expect.poll(() => page.evaluate(() => (window as any).fixture.getContext('main-chat').length)).toBe(3);
            expect(await page.evaluate(() => (window as any).fixture.getContext('main-chat'))).toEqual([
                { path: '/workspace/folder-other', kind: 'directory', source: { kind: 'machine', machineId: 'a' } },
                { path: '/workspace/folder/child.txt', kind: 'file', source: { kind: 'machine', machineId: 'b' } },
                { path: '/workspace/folder/legacy.txt', kind: 'file', source: { kind: 'session' } },
            ]);
        } finally { await context.close(); }
    });

    it('closes a deleted descendant opened while its directory deletion was pending', async () => {
        const { context, page } = await open();
        try {
            await page.evaluate(() => { (window as any).fixture.deleteMode = 'pending'; });
            await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
            await confirm(page, 'Delete');
            await expect.poll(() => page.evaluate(() => (window as any).fixture.deletes.length)).toBe(1);
            await page.getByRole('button', { name: 'folder', exact: true }).click();
            await page.getByRole('button', { name: 'child.txt', exact: true }).click();
            await page.locator('[data-testid="file-content"]').waitFor();
            await page.evaluate(() => (window as any).fixture.resolveDelete({ success: true }));
            await expect.poll(() => page.locator('[data-testid="file-content"]').count()).toBe(0);
            await page.getByRole('button', { name: 'folder-other', exact: true }).waitFor();
            expect(await page.getByRole('button', { name: 'folder', exact: true }).count()).toBe(0);
        } finally { await context.close(); }
    });

});
