// Diagnostic load harness: real fixture processes, no retries, stop after first failure.
const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const fixture = process.argv[2];
const runs = Number(process.argv[3] || 1000);
const parallel = Number(process.argv[4] || 8);
let next = 0, failed = false, passed = 0;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
async function run(id) {
  const start = Date.now(), events = [];
  const owner = fork(fixture, [], {stdio:['ignore','ignore','pipe','ipc'], detached:true, env:{}});
  let phase='readiness', backendPid, ended=false;
  return new Promise(resolve => {
    const log=(event,data)=>events.push({ms:Date.now()-start,event,...data});
    const timer=setTimeout(()=>end('timeout'),5000);
    function end(result) {
      if (ended) return;
      ended=true;
      clearTimeout(timer);
      if(result!=='pass') { failed=true; console.log(JSON.stringify({id,result,phase,events})); }
      else passed++;
      // Each fork has its own detached process group; never touch shared processes.
      if (result!=='pass') { try { process.kill(-owner.pid,'SIGKILL'); } catch {} }
      resolve();
    }
    owner.on('error', e=>log('error',{message:e.message}));
    owner.stderr.on('data', d=>log('stderr',{text:String(d)}));
    owner.on('exit',(code,signal)=>{log('exit',{code,signal});if(phase==='exit') end(code===0&&!alive(owner.pid)&&!alive(backendPid)?'pass':'unexpected-exit-or-live-backend');});
    owner.on('message',m=>{
      log('message',m);
      if (m.backendStarted || m.backendExited) return;
      if(phase==='readiness') { backendPid=m.backendPid; phase='SIGTERM acknowledgement';log('SIGTERM');owner.kill('SIGTERM'); }
      else if(phase==='SIGTERM acknowledgement') {
        try { assert.equal(m.stopping,true); assert.ok(alive(owner.pid)); assert.ok(alive(backendPid)); } catch (e) { log('assertion',{message:e.message}); end('assertion'); return; }
        phase='exit'; log('finish'); owner.send('finish',e=>log('send-callback',{error:e?.message})); }
    });
  });
}
Promise.all(Array.from({length:parallel},async()=>{while(next<runs&&!failed) await run(next++);})).then(()=>{console.log(JSON.stringify({attempted:next,passed,failed,node:process.version,parallel}));process.exitCode=failed?1:0;});
