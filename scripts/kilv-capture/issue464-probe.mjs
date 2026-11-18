// Temporary CI-only causal intervention; removed before delivery.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const target=resolve(process.argv[2]);
const output=resolve('.artifacts/issue464');
mkdirSync(output,{recursive:true});
let source=readFileSync('scripts/kilv-capture/production.mjs','utf8');
source=source.replace('const manifest=[];',`const manifest=[];const records=[];`);
source=source.replace('const page=await context.newPage();',`const page=await context.newPage();
  const events=[];const cdp=await context.newCDPSession(page);
  for(const name of ['layerTreeDidChange','layerPainted'])cdp.on('LayerTree.'+name,event=>events.push({name,time:Date.now(),event}));
  await cdp.send('LayerTree.enable');`);
const original="await page.screenshot({path:resolve(directory,filename),fullPage:true,animations:'disabled',caret:'hide'});";
if(!source.includes(original))throw new Error('Screenshot anchor missing');
source=source.replace(original,`
   if(panelId!=='changelog'){${original}}else{
     await page.evaluate(async()=>{
       await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished));
       await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
       const matches=[...document.querySelectorAll('.herd-rise-sm')].filter(e=>e.textContent.startsWith('November 18 — Projects and machine capacity from the CLI'));
       if(matches.length!==1)throw new Error('Expected exactly one newest entry, got '+matches.length);
       const element=matches[0];const animations=element.getAnimations().filter(a=>a.animationName==='herd-rise-sm');
       if(animations.length!==1||animations[0].playState!=='finished')throw new Error('Expected one finished entry animation');
       const animation=animations[0];
       const measure=()=>{const style=getComputedStyle(element);const rect=element.getBoundingClientRect();return {opacity:style.opacity,transform:style.transform,rect:rect.toJSON()};};
       const original=measure();animation.commitStyles();
       if(JSON.stringify(original)!==JSON.stringify(measure()))throw new Error('commitStyles changed the end state');
       window.__issue464={element,animation,measure,original};
     });
     const phases=[];
     for(const phase of ['retained','cancelled','restored']){
       const state=await page.evaluate(async phase=>{
         const p=window.__issue464;
         if(phase==='cancelled')p.animation.cancel();
         if(phase==='restored')p.animation.finish();
         await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
         const measured=p.measure();
         if(JSON.stringify(measured)!==JSON.stringify(p.original))throw new Error(phase+' changed end styles or geometry');
         if(phase==='cancelled'&&p.element.getAnimations().includes(p.animation))throw new Error('Cancelled effect still active');
         if(phase!=='cancelled'&&p.animation.playState!=='finished')throw new Error(phase+' did not retain finished effect');
         return {measured,playState:p.animation.playState,activeAnimations:p.element.getAnimations().length};
       },phase);
       const name=filename.replace('.png','-'+phase+'.png');const start=Date.now();
       await page.screenshot({path:resolve(directory,name),fullPage:true,animations:'disabled',caret:'hide'});
       const end=Date.now();phases.push({phase,state,start,end,filename:name,sha256:createHash('sha256').update(readFileSync(resolve(directory,name))).digest('hex')});
     }
     const remote=await cdp.send('Runtime.evaluate',{expression:'window.__issue464.element'});
     const described=await cdp.send('DOM.describeNode',{objectId:remote.result.objectId});
     records.push({theme,viewport,backendNodeId:described.node.backendNodeId,phases,events});
     writeFileSync(resolve(directory,'lifecycle.json'),JSON.stringify(records,null,2)+'\\n');
     console.log(JSON.stringify({theme,viewport,phases}));
     writeFileSync(resolve(directory,filename),readFileSync(resolve(directory,phases[0].filename)));
   }`);
const generated=resolve(target,'scripts/kilv-capture/issue464-generated.mjs');
writeFileSync(generated,source);
const app=resolve(target,'server/packages/happyherd-app');
const executable=execFileSync(process.execPath,['-e',"console.log(require('playwright-core').chromium.executablePath())"],{cwd:app,encoding:'utf8'}).trim();
execFileSync(process.execPath,[generated,resolve(app,'dist-ci')],{cwd:target,stdio:'inherit',env:{...process.env,KILV_GOLDEN:'1',HAPPYHERD_BROWSER_EXECUTABLE:executable,KILV_OUTPUT_DIR:output}});
