import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const appRoot = resolve(repoRoot, 'server/packages/happy-app');
const require = createRequire(resolve(appRoot, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const ts = require('typescript');
const iconRoot = dirname(require.resolve('@expo/vector-icons'));

// Reuse existing synthetic service/state fixtures without executing their tests.
export function readFixtureModules(file, context = {}) {
  const full = resolve(appRoot, file);
  const source = readFileSync(full, 'utf8');
  const ast = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
  let initializer;
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(ast) === 'virtualModules') initializer = declaration.initializer.getText(ast);
    }
  }
  if (!initializer) throw new Error(`No virtualModules in ${file}`);
  return runInNewContext(`(${initializer})`, { appRoot, here: dirname(full), ...context });
}

const nativeBridge = `
import * as RN from 'react-native-web'; import React from 'react';
export * from 'react-native-web';
export const TurboModuleRegistry = {get:()=>null,getEnforcing:()=>({})};
export const useAnimatedValue = value => React.useRef(new RN.Animated.Value(value)).current;
`;
const themeBridge = `
import React from 'react'; import {lightTheme,darkTheme} from '@/theme';
const theme = new URLSearchParams(location.search).get('theme')==='dark' ? darkTheme : lightTheme;
const rt = {screen:{width:innerWidth,height:innerHeight},insets:{top:0,bottom:0,left:0,right:0},fontScale:1,pixelRatio:1,statusBar:{height:0},navigationBar:{height:0},themeName:new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light'};
const breaks={xs:0,sm:300,md:500,lg:800,xl:1200};
function responsive(v){
 if(!v || typeof v!=='object' || Array.isArray(v)) return v;
 const keys=Object.keys(v);
 if(keys.some(k=>k in breaks) && keys.every(k=>k in breaks)){let chosen;for(const k of keys.sort((a,b)=>breaks[a]-breaks[b]))if(innerWidth>=breaks[k])chosen=v[k];return chosen;}
 return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,responsive(x)]));
}
export const StyleSheet={hairlineWidth:1,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0},configure(){},create(factory){
 const originals=typeof factory==='function'?factory(theme,rt):factory;
 const styles={...originals};
 const apply=params=>{for(const [key,value]of Object.entries(originals)){if(typeof value==='function'){styles[key]=(...args)=>responsive(value(...args));continue;}let next={...value};delete next.variants;for(const[name,options]of Object.entries(value?.variants??{}))Object.assign(next,options[String(params[name])]??{});styles[key]=responsive(next);}};
 apply({}); Object.defineProperty(styles,'useVariants',{value:apply});return styles;
}};
export const useUnistyles=()=>({theme,rt});
export const withUnistyles=(Component,mapper)=>React.forwardRef((props,ref)=>React.createElement(Component,{...(mapper?mapper(theme,rt):{}),...props,ref}));
export const UnistylesRuntime={...rt,setTheme(){},setAdaptiveThemes(){},setRootViewBackgroundColor(){}};
`;
const fontBridge = `export const isLoaded=()=>true;export const isLoading=()=>false;export const loadAsync=async()=>{};export const useFonts=()=>[true,null];export const getLoadedFonts=()=>['SpaceGrotesk-Regular','JetBrainsMono-Regular'];`;
const imageBridge = `import React from 'react';import {Image as NativeImage} from 'react-native-web';export const Image=React.forwardRef(({contentFit,source,...props},ref)=>React.createElement(NativeImage,{...props,ref,source:typeof source==='string'?{uri:source}:source,resizeMode:contentFit==='cover'?'cover':'contain'}));`;

export const baseVirtualModules = {
  'react-native': nativeBridge,
  'react-native-unistyles': themeBridge,
  'expo-font': fontBridge,
  'expo-image': imageBridge,
};

function sourceFile(path) {
  const ext = extname(path);
  const candidates = ext ? [path] : [path+'.web.tsx',path+'.web.ts',path+'.web.js',path+'.tsx',path+'.ts',path+'.js',path+'/index.web.tsx',path+'/index.web.js',path+'/index.tsx',path+'/index.ts',path+'/index.js'];
  return candidates.find(candidate=>existsSync(candidate));
}

export async function createCapture({ group, entrySource, entryFile, virtualModules={}, onResolve, outDir, css:extraCss='' }) {
  const directory=outDir??resolve(repoRoot,'docs/acceptance/issue-287/panels',group);
  mkdirSync(directory,{recursive:true});
  const modules={...virtualModules,...baseVirtualModules};
  // The theme, typography, icons and the captured components remain source-owned.
  for(const key of ['@/theme','@/constants/Typography','@/components/StyledText','@expo/vector-icons']) delete modules[key];
  const plugin={name:'kilv-review-fixture',setup(builder){
    builder.onResolve({filter:/.*/},args=>{
      if(Object.hasOwn(modules,args.path)) return {path:args.path,namespace:'kilv-mock'};
      const custom=onResolve?.(args);if(custom)return custom;
      if(args.path.startsWith('@/')){const path=sourceFile(resolve(appRoot,'sources',args.path.slice(2)));if(path)return {path};}
      if(args.path.startsWith('.') && args.importer.includes('/node_modules/')){
        const base=resolve(dirname(args.importer),args.path);
        const web=extname(base)?base.replace(/\.(js|ts|tsx)$/,'.web.$1'):sourceFile(base+'.web');
        if(web && web!==base && existsSync(web))return {path:web};
        for(const suffix of ['.web.js','.web.ts','.web.tsx'])if(existsSync(base+suffix))return {path:base+suffix};
      }
      if(args.path.startsWith('.') && args.importer.startsWith(resolve(appRoot,'sources'))){const path=sourceFile(resolve(dirname(args.importer),args.path));if(path)return {path};}
      return null;
    });
    builder.onLoad({filter:/.*/,namespace:'kilv-mock'},args=>({contents:modules[args.path],loader:'tsx',resolveDir:appRoot}));
  }};
  const bundle=await build({
    ...(entryFile?{entryPoints:[resolve(appRoot,entryFile)]}:{stdin:{contents:entrySource,loader:'tsx',resolveDir:appRoot,sourcefile:`${group}-capture.tsx`}}),
    absWorkingDir:appRoot,nodePaths:[resolve(repoRoot,'server/node_modules')],outfile:resolve(appRoot,`fixture-output/${group}.js`),bundle:true,write:false,metafile:true,format:'iife',platform:'browser',jsx:'automatic',sourcemap:'linked',
    define:{__DEV__:'false','process.env.EXPO_OS':'"web"','process.env.NODE_ENV':'"test"'},
    loader:{'.js':'jsx','.png':'dataurl','.jpg':'dataurl','.webp':'dataurl','.ttf':'dataurl','.woff2':'dataurl','.svg':'dataurl'},plugins:[plugin],
  });
  const sourceInputs=new Set(Object.keys(bundle.metafile.inputs).filter(path=>!path.startsWith('kilv-mock:')).map(path=>resolve(appRoot,path)));
  writeFileSync(resolve(directory,`environment-${group}.json`),JSON.stringify({
    evidenceType:'component-fixture',sourceRevision:'a38fae51c2f99d34bc4d81b24ccfd4c7aa611b05',
    sourceInputs:[...sourceInputs].filter(path=>path.startsWith(resolve(appRoot,'sources'))).map(path=>relative(appRoot,path)),
    mockedModules:Object.keys(modules),
    visualAdapters:['React Native Web','Unistyles style/theme evaluation','Expo font loader with repository font files','Expo Image rendered by React Native Web Image'],
  },null,2)+'\n');
  const outputs=new Map(bundle.outputFiles.map(file=>['/'+basename(file.path),file.contents]));
  const assets=new Map();
  let css='';
  for(const family of ['SpaceGrotesk-Regular','SpaceGrotesk-Medium','SpaceGrotesk-SemiBold','JetBrainsMono-Regular','JetBrainsMono-SemiBold']){
    assets.set('/fonts/'+family+'.ttf',readFileSync(resolve(appRoot,'sources/assets/fonts',family+'.ttf')));
    css+=`@font-face{font-family:'${family}';src:url('/fonts/${family}.ttf') format('truetype');font-display:block;}\n`;
  }
  for(const name of ['Ionicons','Octicons','MaterialCommunityIcons','MaterialIcons','FontAwesome','FontAwesome5','Feather','AntDesign','Entypo','SimpleLineIcons']){
    const file=resolve(iconRoot,name+'.js');if(!existsSync(file))continue;
    const code=readFileSync(file,'utf8');const fontName=code.match(/createIconSet\(glyphMap, ['"]([^'"]+)/)?.[1];
    const fontFile=code.match(/import font from ['"](.+?\.(?:ttf|otf))['"]/)?.[1];
    if(!fontName||!fontFile)continue;
    const route='/fonts/'+basename(fontFile);assets.set(route,readFileSync(resolve(iconRoot,fontFile)));
    css+=`@font-face{font-family:'${fontName}';src:url('${route}') format('truetype');font-display:block;}\n`;
  }
  const manifest=[]; const errors=new WeakMap();
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/workspace-live-sw.js'){
      res.setHeader('content-type','text/javascript; charset=utf-8');
      res.setHeader('service-worker-allowed','/');
      res.end(readFileSync(resolve(appRoot,'public/workspace-live-sw.js')));return;
    }
    if(outputs.has(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.map')?'application/json':'text/javascript');res.end(outputs.get(url.pathname));return;}
    if(assets.has(url.pathname)){res.setHeader('content-type','font/ttf');res.end(assets.get(url.pathname));return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const dark=url.searchParams.get('theme')==='dark';
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${group}.css"><style>${css}html,body,#root{margin:0;height:100%;min-height:100%;font-family:SpaceGrotesk-Regular;background:${dark?'#010204':'#F7EFDD'};color:${dark?'#F7F4EC':'#14100A'}}${extraCss}</style></head><body><div id="root"></div><script>globalThis.global=globalThis;</script><script src="/${group}.js"></script></body></html>`);
  });
  // A bundle without CSS still has a valid empty stylesheet response.
  if(!outputs.has('/'+group+'.css'))outputs.set('/'+group+'.css',new Uint8Array());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({...(process.env.HAPPYHERD_BROWSER_EXECUTABLE?{executablePath:process.env.HAPPYHERD_BROWSER_EXECUTABLE}:{channel:'chrome'}),headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
  async function open({theme='light',viewport={width:1440,height:900},params={},init}={}){
    const page=await browser.newPage({viewport,deviceScaleFactor:1,colorScheme:theme});
    errors.set(page,[]);page.on('pageerror',error=>errors.get(page).push(error.message));
    if(init)await page.addInitScript(init);
    const query=new URLSearchParams({theme,...params});await page.goto(origin+'/?'+query,{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);return page;
  }
  async function capture(page,{panelId,label,sourcePaths,state='default',theme,viewport,locator,limitations=[],...extra}){
    for(const source of sourcePaths){
      const path=source.startsWith('server/')?resolve(repoRoot,source):source.startsWith('sources/')?resolve(appRoot,source):resolve(appRoot,'sources',source);
      if(!sourceInputs.has(path))throw new Error(`${panelId}: claimed source is not in the real bundle: ${source}`);
    }
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('img').evaluateAll(images=>Promise.all(images.filter(img=>img.src).map(img=>img.decode().catch(()=>undefined))));
    const pageErrors=errors.get(page)??[];if(pageErrors.length)throw new Error(`${panelId}: ${pageErrors.join('; ')}`);
    const target=locator??page.locator('#root');await target.waitFor({state:'visible'});
    const geometry=await target.boundingBox();if(!geometry||geometry.width<20||geometry.height<20)throw new Error(`${panelId}: target has no reviewable geometry`);
    const text=await target.evaluate(element=>[
      element.innerText,
      ...[...element.querySelectorAll('input,textarea')].map(field=>field.value||field.placeholder||''),
    ].filter(Boolean).join('\n'));
    if(text.trim().length<2)throw new Error(`${panelId}: empty target`);
    const width=(viewport??page.viewportSize()).width;
    const filename=`${panelId}-${state}-${theme??new URL(page.url()).searchParams.get('theme')}-${width}.png`;
    await (locator?target:page).screenshot({path:resolve(directory,filename),...(locator?{}:{fullPage:true})});
    const result={panelId,label,sourcePaths,state,theme:theme??new URL(page.url()).searchParams.get('theme'),viewport:viewport??page.viewportSize(),filename,evidenceType:'component-fixture',sourceRevision:'a38fae51c2f99d34bc4d81b24ccfd4c7aa611b05',environment:`environment-${group}.json`,limitations:['Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.',...limitations],geometry,textExcerpt:text.slice(0,250),pageErrors,...extra};
    manifest.push(result);writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return result;
  }
  async function close(){await browser.close();await new Promise(resolve=>server.close(resolve));}
  return {browser,origin,open,capture,close,manifest,directory};
}
