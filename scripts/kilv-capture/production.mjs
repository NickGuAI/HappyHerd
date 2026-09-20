import { createRequire } from 'node:module';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { appRoot, repoRoot } from './common.mjs';

const require=createRequire(resolve(appRoot,'package.json'));
const {chromium}=require('playwright-core');
const dist=resolve(process.argv[2]??resolve(appRoot,'dist-ci'));
const directory=process.env.KILV_OUTPUT_DIR ? resolve(process.env.KILV_OUTPUT_DIR,'production') : resolve(repoRoot,'docs/acceptance/issue-287/panels/production');
mkdirSync(directory,{recursive:true});
const index=readFileSync(resolve(dist,'index.html'),'utf8');
const artifactIndexSha256=createHash('sha256').update(index).digest('hex');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.woff2':'font/woff2','.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
let origin;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(/^\/(?:v[123]|api|socket)/.test(url.pathname)){res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"offline verification host"}');return;}
  const file=resolve(dist,extname(url.pathname)?decodeURIComponent(url.pathname).replace(/^\/+/, ''):'index.html');
  if(!file.startsWith(dist+sep)){res.writeHead(403);res.end();return;}
  try{await stat(file);res.setHeader('content-type',types[extname(file)]??'application/octet-stream');
    if(file===resolve(dist,'index.html'))res.end(index.replace(/<head[^>]*>/i,head=>head+`<script>window.__HAPPY_CONFIG__=${JSON.stringify({serverUrl:origin,disableAnalytics:true})}</script>`));
    else createReadStream(file).pipe(res);
  }catch{res.writeHead(404);res.end();}
});
await new Promise((done,reject)=>{server.once('error',reject);server.listen(process.env.KILV_GOLDEN ? 4177 : 0,'127.0.0.1',done);});
origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.env.HAPPYHERD_BROWSER_EXECUTABLE?{executablePath:process.env.HAPPYHERD_BROWSER_EXECUTABLE}:{channel:'chrome'}),headless:true,args:process.env.KILV_GOLDEN?['--disable-partial-raster']:[]});
const manifest=[];
try{
 for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport,colorScheme:theme,locale:'en-US',timezoneId:'UTC',deviceScaleFactor:1,hasTouch:viewport.width<500,isMobile:viewport.width<500});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const shot=async(panelId,label,sourcePaths,state,entry,limitations=[])=>{
    if(process.env.KILV_GOLDEN) await page.mouse.move(0,0);
   await page.evaluate(()=>document.fonts.ready);
    await page.locator('img').evaluateAll(images=>Promise.all(images.filter(img=>img.src).map(img=>img.decode().catch(()=>undefined))));
    if(process.env.KILV_GOLDEN) await page.evaluate(async ()=>{
      // The changelog decoration is animated WebP, not a CSS animation. Keep
      // its real first frame rather than comparing whichever frame won a race.
      for(const image of document.querySelectorAll('*')){
        const background=getComputedStyle(image).backgroundImage;
        const url=image instanceof HTMLImageElement ? image.src : background.match(/url\(["']?(.*?)["']?\)/)?.[1];
        if(!url?.includes('mouse-on-the-phone'))continue;
        const decoder=new ImageDecoder({data:new Uint8Array(await (await fetch(url)).arrayBuffer()),type:'image/webp'});
        const {image:frame}=await decoder.decode({frameIndex:0});
        const canvas=document.createElement('canvas');canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;
        canvas.getContext('2d').drawImage(frame,0,0);
        if(image instanceof HTMLImageElement){image.srcset='';image.src=canvas.toDataURL();await image.decode();}
        else image.style.backgroundImage=`url("${canvas.toDataURL()}")`;
        frame.close();decoder.close();
      }
    });
   if(errors.length)throw new Error(`${panelId}: ${errors.join('; ')}`);
   const text=await page.locator('body').innerText();if(text.trim().length<20)throw new Error('Blank production panel '+panelId);
   const filename=`${panelId}-${state}-${theme}-${viewport.width}.png`;
    await page.screenshot({path:resolve(directory,filename),fullPage:true,animations:'disabled',caret:'hide'});
   manifest.push({panelId,label,sourcePaths,theme,viewport,state,filename,evidenceType:'production-export',sourceRevision:'a38fae51c2f99d34bc4d81b24ccfd4c7aa611b05',artifactIndexSha256,entry,route:new URL(page.url()).pathname,limitations:['Unmodified exported production UI on an isolated loopback static host; backend offline; not deployed/authenticated evidence.',...limitations],pageErrors:errors.slice(),textExcerpt:text.slice(0,250)});
   writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  };
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.getByTestId('kilv-landing-art').waitFor();
  await shot('landing','Signed-out landing',['app/(app)/index.tsx','app/(app)/_layout.tsx','app/_layout.tsx','app/+html.tsx','components/navigation/Header.tsx','components/RoundButton.tsx'],'default','Home route');
  await page.getByText('Restore with Secret Key',{exact:true}).click();
  const input=page.locator('textarea,input').first();await input.waitFor();await input.fill('Synthetic review draft — not a secret key');
  await shot('restore-key','Restore with Secret Key',['app/(app)/restore/manual.tsx'],'draft','Visible Home > Restore with Secret Key');
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.getByText('Login with mobile app',{exact:true}).click();
  await page.getByText('Restore with Secret Key instead',{exact:false}).waitFor();
   const dialog=page.getByRole('dialog');
   if(process.env.KILV_GOLDEN) await dialog.waitFor({state:'visible'});
  if(await dialog.count()){
    const okay=dialog.getByText('OK',{exact:true});if(await okay.count())await okay.click();
    if(process.env.KILV_GOLDEN) await dialog.waitFor({state:'hidden'});
  }
  await shot('restore-device','Link a mobile device',['app/(app)/restore/index.tsx'],'offline','Visible Home > Login with mobile app',['The offline endpoint cannot issue/complete a QR pairing request; no ready/authenticated QR state is claimed.']);
  await page.goto(origin+'/server',{waitUntil:'networkidle'});
  await page.locator('input').first().waitFor();
  await page.locator('input').first().fill('https://review.invalid');
  await shot('server-config','Server configuration',['app/(app)/server.tsx','components/ItemGroup.tsx'],'draft','Direct production route /server',['Server change was not submitted.']);
  await page.goto(origin+'/changelog',{waitUntil:'networkidle'});
  await page.getByText('September 19 — Terminal pairing layout',{exact:true}).waitFor();
  await shot('changelog','Changelog with KILV release entry',['app/(app)/changelog.tsx','changelog/changelog.json','components/markdown/MarkdownView.web.tsx'],'latest-entries','Direct production route /changelog');
  await context.close();
 }
 console.log(`${manifest.length} production-export panel screenshots captured`);
}finally{await browser.close();await new Promise(done=>server.close(done));}
