// Temporary CI evidence collector; invokes the production capture unchanged.
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=process.cwd();
const require=createRequire(resolve(root,'server/packages/happyherd-app/package.json'));
const browser=require('playwright-core').chromium.executablePath();
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const output=resolve('.artifacts/issue464');
mkdirSync(output,{recursive:true});
const names=['light','dark'].flatMap(theme=>[1440,390].map(width=>`changelog-latest-entries-${theme}-${width}.png`));
const captures=[];
for(let capture=1;capture<=10;capture++){
  const directory=resolve(output,String(capture).padStart(2,'0'));
  execFileSync(process.execPath,['scripts/kilv-capture/production.mjs'],{stdio:'inherit',env:{...process.env,KILV_GOLDEN:'1',KILV_OUTPUT_DIR:directory,HAPPYHERD_BROWSER_EXECUTABLE:browser}});
  const hashes=Object.fromEntries(names.map(name=>[name,sha(resolve(directory,'production',name))]));
  captures.push({capture,hashes});
  writeFileSync(resolve(output,'hashes.json'),JSON.stringify({sourceRevision,productionScriptSha256:sha('scripts/kilv-capture/production.mjs'),captures},null,2)+'\n');
  console.log(JSON.stringify(captures.at(-1)));
}
for(const name of names)if(new Set(captures.map(row=>row.hashes[name])).size!==1)throw new Error(`Unstable: ${name}`);
if(process.env.PROBE_ONE_PIXEL==='true'){
  // Current main added changelog content after the original proof. Stage only
  // these four fresh CI baselines for the unchanged one-pixel comparator.
  for(const name of names)copyFileSync(resolve(output,'01/production',name),resolve('docs/acceptance/issue-287/golden',`production-${name}`));
  const result=spawnSync(process.execPath,['scripts/kilv-golden.mjs','one-pixel'],{stdio:'inherit'});
  const summary=JSON.parse(readFileSync('.artifacts/kilv-golden/summary.json'));
  cpSync('.artifacts/kilv-golden',resolve(output,'one-pixel'),{recursive:true});
  writeFileSync(resolve(output,'one-pixel-exit.json'),JSON.stringify({status:result.status,signal:result.signal})+'\n');
  if(result.status!==1||summary.variants!==28||summary.failed!==1||summary.results.filter(row=>row.pixels===1&&!row.dimensionsChanged).length!==1)throw new Error('One-pixel rejection did not produce exactly one differing pixel');
  console.log('One-pixel sensitivity: comparator exited 1, exactly one pixel differed; other 27 variants matched.');
}
