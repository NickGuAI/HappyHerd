// Temporary CI-only experiment; removed before delivery.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const target = resolve(process.argv[2] ?? '.');
const output = resolve(process.env.PROBE_OUTPUT ?? '.artifacts/issue464');
mkdirSync(output, { recursive: true });
let source = readFileSync('scripts/kilv-capture/production.mjs', 'utf8');
source = source.replace("const manifest=[];", `const manifest=[];
const strategy=process.env.PROBE_STRATEGY;
let capture=0;
const records=[];`);
source = source.replace("const page=await context.newPage();", `
  if(strategy==='none')await context.addInitScript(()=>{
    const style=document.createElement('style');style.textContent='.herd-rise-sm { animation: none !important; }';
    new MutationObserver((_,observer)=>{if(document.documentElement){document.documentElement.append(style);observer.disconnect();}}).observe(document,{childList:true,subtree:true});
  });
  const page=await context.newPage();
  const cdp=await context.newCDPSession(page);
  let layers=[];cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[];});
  await cdp.send('LayerTree.enable');`);
source = source.replace("const filename=`${panelId}-${state}-${theme}-${viewport.width}.png`;", `
   if(strategy==='wait')await page.evaluate(async()=>{
     await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation=>animation.finished));
     await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   });
   const animationState=await page.evaluate(()=>Array.from(document.querySelectorAll('.herd-rise-sm')).slice(0,2).map(element=>({
     opacity:getComputedStyle(element).opacity,transform:getComputedStyle(element).transform,
     animations:element.getAnimations().map(a=>({name:a.animationName,time:a.currentTime,state:a.playState,timing:a.effect.getComputedTiming()}))
   })));
   const layerState=await Promise.all(layers.filter(layer=>layer.drawsContent).map(async layer=>({...layer,...await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId}).catch(()=>({}))})));
   const filename=\`\${panelId}-\${state}-\${theme}-\${viewport.width}-\${String(capture).padStart(2,'0')}.png\`;`);
source = source.replace("manifest.push({panelId", `records.push({strategy,capture,theme,viewport,filename,sha256:createHash('sha256').update(readFileSync(resolve(directory,filename))).digest('hex'),animationState,layerState});
   writeFileSync(resolve(directory,'probe.json'),JSON.stringify(records,null,2)+'\\n');
   console.log(JSON.stringify({strategy,capture,theme,width:viewport.width,sha256:records.at(-1).sha256}));
   manifest.push({panelId`);
// Keep the production navigation sequence; only retain changelog screenshots.
source = source.replace("if(process.env.KILV_GOLDEN) await page.mouse.move(0,0);", "if(panelId!=='changelog')return;\n    if(process.env.KILV_GOLDEN) await page.mouse.move(0,0);");
source = source.replace("await page.goto(origin+'/changelog'", "for(capture=1;capture<=10;capture++){\n  await page.goto(origin+'/changelog'");
source = source.replace('await context.close();', '}\n  await context.close();');
const generated=resolve(target,'scripts/kilv-capture/issue464-generated.mjs');
writeFileSync(generated,source);
const app=resolve(target,'server/packages/happyherd-app');
const executable=execFileSync(process.execPath,['-e',"console.log(require('playwright-core').chromium.executablePath())"],{cwd:app,encoding:'utf8'}).trim();
for(const strategy of ['original','wait','none']){
  execFileSync(process.execPath,[generated,resolve(app,'dist-ci')],{cwd:target,stdio:'inherit',env:{...process.env,KILV_GOLDEN:'1',HAPPYHERD_BROWSER_EXECUTABLE:executable,KILV_OUTPUT_DIR:resolve(output,strategy),PROBE_STRATEGY:strategy}});
}
