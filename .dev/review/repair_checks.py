"""Prepare reviewed fixes on isolated refs, never main or original PR refs."""
import json, os, pathlib, subprocess, sys
ROOT=pathlib.Path.cwd()
OUT=pathlib.Path(os.environ['RUNNER_TEMP'])/'check-repair';OUT.mkdir(exist_ok=True)
REPO='NickGuAI/HappyHerd'
MAIN='4c9454af40581865d43ec08ec90d987d19ab5f68'
HEADS={276:'2b57d8343b13bdae9ff1948ab3460912608676a4',280:'bee3bcd5c16557cbb537d74efb0c863a6036dd9f',285:'2f9893c9f30f5672b2b262f245ae861bd78221ec'}
N=int(os.environ['REPAIR_PR']);HEAD=HEADS[N]
def run(args,check=True):
 p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if check and p.returncode: raise RuntimeError(f'{args}:\n{p.stdout}')
 return p

def git(*args):return run(['git',*args]).stdout.strip()
def api(path):return json.loads(run(['gh','api',f'repos/{REPO}/{path}']).stdout)
def replace(path,old,new):
 f=ROOT/path;t=f.read_text();assert t.count(old)==1,(path,old[:80],t.count(old));f.write_text(t.replace(old,new))

def prepare():
 assert api('branches/main')['commit']['sha']==MAIN
 assert api(f'pulls/{N}')['head']['sha']==HEAD
 git('config','user.name','HappyHerd Maintainers');git('config','user.email','maintainers@happyherd.example')
 git('fetch','origin',HEAD);git('checkout','--detach',HEAD)
 if N==276:
  path='server/packages/happy-app/sources/components/tools/ToolView.test.ts'
  replace(path,"import type { ToolCall } from '@/sync/typesMessage';", "import type { ToolCall } from '@/sync/typesMessage';\nimport type { AgentFormCommunication } from '@/sync/agentCommunications';")
  replace(path,"const settings = vi.hoisted(() => ({ compact: false, platform: 'ios', width: 390 }));", "const settings = vi.hoisted(() => ({ compact: false, platform: 'ios', width: 390, communication: null as AgentFormCommunication | null }));")
  replace(path,"vi.mock('@/sync/storage', () => ({ useSetting: () => settings.compact, useLocalSetting: () => false, useSession: () => null }));", "vi.mock('@/sync/storage', () => ({\n    useSetting: () => settings.compact, useLocalSetting: () => false, useSession: () => null,\n    useSessionAgentFormCommunication: (_sessionId: string, toolUseId: string) =>\n        settings.communication?.toolUseId === toolUseId ? settings.communication : null,\n}));")
  replace(path,"    settings.width = 390;\n});", "    settings.width = 390;\n    settings.communication = null;\n});")
  replace(path,"        for (const name of ['request_user_input', 'file']) {\n            const row = render(React.createElement(ToolView, { tool: tool(name), metadata: null }));", "        settings.communication = {\n            id: 'form-1', toolUseId: 'question-call', kind: 'form', createdAt: 1, status: 'pending',\n            questions: [{ id: 'choice', question: 'Choose a target', options: [{ label: 'Main', value: 'main' }], multiple: false, allowCustom: false }],\n        };\n        for (const name of ['request_user_input', 'file']) {\n            const row = render(React.createElement(ToolView, { tool: { ...tool(name), callId: 'question-call' }, metadata: null, sessionId: 's1' }));")
  anchor="    it('uses the wire title in the detail header', () => {"
  new="""    it('does not invent a question form when the matching communication is absent', () => {
        settings.compact = true;
        const pending = {
            ...tool('request_user_input'), callId: 'missing-call',
            permission: { id: 'p1', status: 'pending' as const },
        };
        const row = render(React.createElement(ToolView, { tool: pending, metadata: null, sessionId: 's1' }));
        expect(row.root.findAllByType('SpecializedView')).toHaveLength(0);
        expect(row.root.findAllByType('CodeView')).toHaveLength(1);
        expect(row.root.findAllByType('PermissionFooter')).toHaveLength(1);
    });

"""+anchor
  replace(path,anchor,new)
  subject='test(plans): align tool rendering fixtures with communication state'
  row=f'NATIVE_PLAN_QUESTION_RENDER_FIXTURE\taccepted\t{subject}\t{path}\n'
 elif N==280:
  path='server/packages/happy-cli/src/daemon/run.resume.test.ts'
  old="""      const fallbackTimer = timeoutSpy.mock.calls.findIndex((call) => call[1] === 1_000);
      await daemonRun;
      if (fallbackTimer >= 0) {
        clearTimeout(timeoutSpy.mock.results[fallbackTimer].value as ReturnType<typeof setTimeout>);
      }"""
  new="""      // Own the timers created synchronously by shutdown instead of guessing
      // their delay. process.exit is mocked, so its fallback otherwise escapes
      // this fixture and can fire after the process mock has been restored.
      const shutdownTimers = timeoutSpy.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value as ReturnType<typeof setTimeout>);
      try {
        expect(shutdownTimers).toHaveLength(1);
        await daemonRun;
      } finally {
        for (const timer of shutdownTimers) clearTimeout(timer);
      }"""
  replace(path,old,new)
  subject='test(daemon): cancel fixture-owned shutdown fallback timers'
  row=f'DAEMON_SHUTDOWN_FIXTURE_TIMER\taccepted\t{subject}\t{path}\n'
 else:
  tree=git('rev-parse','HEAD^{tree}');message=git('show','-s','--format=%B','HEAD')
  assert tree=='51c448931b91de45d471d0ff3ca02b8e2bc266e2'
  assert git('rev-parse','HEAD^')==MAIN
  new=git('commit-tree',tree,'-p',MAIN,'-m',message)
  git('checkout','--detach',new)
  assert git('diff','--stat',HEAD,new)==''
  return
 ledger=ROOT/'docs/owned-patches.tsv';text=ledger.read_text();assert row.split('\t')[0] not in text
 ledger.write_text(text.rstrip()+'\n'+row)
 git('add','--',path,'docs/owned-patches.tsv')
 git('diff','--cached','--check')
 git('commit','-m',subject)

def publish():
 assert api('branches/main')['commit']['sha']==MAIN
 p=api(f'pulls/{N}');assert p['head']['sha']==HEAD
 run(['git','remote','add','upstream','https://github.com/slopus/happy.git'],check=False)
 git('fetch','upstream','main')
 for i,args in enumerate([['node','scripts/lint-source.mjs'],['bash','scripts/verify-patch-discipline.sh'],['node','scripts/verify-public-boundary.mjs']]):
  result=run(args,check=False);(OUT/f'gate-{i}.log').write_text(result.stdout);assert result.returncode==0,result.stdout
 new=git('rev-parse','HEAD');stage=f'chore/pr-review-ci-{os.environ["GITHUB_RUN_ID"]}-{N}'
 git('push','origin',f'{new}:refs/heads/{stage}')
 if N==285:
  # Preserve the original PR and contributor fork. This is only a ready-to-use,
  # byte-identical correction in the owned repository; it is not published there.
  bundle=OUT/'pr-285-canonical-identity.bundle'
  git('branch','review-pr-285-canonical-identity',new)
  git('bundle','create',str(bundle),'review-pr-285-canonical-identity',f'^{MAIN}')
 (OUT/'diff.patch').write_text(git('diff','--binary',HEAD,new)+'\n')
 report={'pr':N,'old':HEAD,'new':new,'stage':stage,'source_repo':p['head']['repo']['full_name'],'source_branch':p['head']['ref'],'main':MAIN,'tree':git('rev-parse','HEAD^{tree}')}
 (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if sys.argv[1]=='prepare':prepare()
elif sys.argv[1]=='publish':publish()
else:raise RuntimeError('Unknown operation')
