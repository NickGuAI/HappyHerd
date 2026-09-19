import json, os, pathlib, subprocess, sys
ROOT=pathlib.Path.cwd();OUT=pathlib.Path(os.environ['RUNNER_TEMP'])/'browser-repair';OUT.mkdir(exist_ok=True)
REPO='NickGuAI/HappyHerd';HEAD='abc15635e9dbb585fec92a82be22826d501f282c';MAIN='4c9454af40581865d43ec08ec90d987d19ab5f68'
PATH='server/packages/happy-app/sources/components/sideChatHeader.browser.test.ts'
SUBJECT='test(workspace): serve browser fixture code without inline source maps'
def run(args,check=True):
 p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if check and p.returncode:raise RuntimeError(f'{args}:\n{p.stdout}')
 return p

def git(*args):return run(['git',*args]).stdout.strip()
def api(path):return json.loads(run(['gh','api',f'repos/{REPO}/{path}']).stdout)
def verify_heads():
 assert api('branches/main')['commit']['sha']==MAIN
 assert api('pulls/279')['head']['sha']==HEAD

def prepare():
 verify_heads();git('config','user.name','HappyHerd Maintainers');git('config','user.email','maintainers@happyherd.example')
 git('fetch','origin',HEAD);git('checkout','--detach',HEAD)
 f=ROOT/PATH;original=f.read_text();s=original
 assert s.count("sourcemap: 'inline'")==1
 s=s.replace("sourcemap: 'inline'","sourcemap: 'external'")
 old="""        const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
        server = createServer((_request, response) => {"""
 new="""        const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
        const sourceMap = bundle.outputFiles.find((file) => file.path.endsWith('.js.map'))!.text;
        // Keep the same executable fixture and debugging map, without embedding
        // a base64 source map in every navigation's HTML parser input. Prepare
        // these responses once rather than escaping the whole bundle per request.
        const executable = script + '\\n//# sourceMappingURL=/fixture.js.map';
        const html = '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:100%;margin:0}</style><main id="root"></main><script>globalThis.global=globalThis;</script><script src="/fixture.js"></script>';
        server = createServer((_request, response) => {
            if (_request.url === '/fixture.js') {
                response.setHeader('content-type', 'text/javascript; charset=utf-8');
                response.end(executable);
                return;
            }
            if (_request.url === '/fixture.js.map') {
                response.setHeader('content-type', 'application/json; charset=utf-8');
                response.end(sourceMap);
                return;
            }"""
 assert s.count(old)==1;s=s.replace(old,new)
 lines=s.splitlines();matches=[i for i,line in enumerate(lines) if 'response.end(`' in line and 'globalThis.global=globalThis;${script.replaceAll' in line]
 assert len(matches)==1
 lines[matches[0]]='            response.end(html);'
 s='\n'.join(lines)+'\n'
 # Guard the claimed scope: not a single test body/assertion/budget is edited.
 marker="    it('opens a side chat by tapping its header'"
 test_start=original.index('\n    it',original.index('    beforeAll('))
 assert s[s.index('\n    it',s.index('    beforeAll(')):]==original[test_start:]
 f.write_text(s)
 ledger=ROOT/'docs/owned-patches.tsv';text=ledger.read_text();key='WORKSPACE_BROWSER_FIXTURE_PAYLOAD';assert key not in text
 ledger.write_text(text.rstrip()+f'\n{key}\taccepted\t{SUBJECT}\t{PATH}\n')
 git('add','--',PATH,'docs/owned-patches.tsv');git('diff','--cached','--check');git('commit','-m',SUBJECT)


def publish():
 verify_heads();run(['git','remote','add','upstream','https://github.com/slopus/happy.git'],check=False);git('fetch','upstream','main')
 for i,args in enumerate([['node','scripts/lint-source.mjs'],['bash','scripts/verify-patch-discipline.sh'],['node','scripts/verify-public-boundary.mjs']]):
  p=run(args,check=False);(OUT/f'gate-{i}.log').write_text(p.stdout);assert p.returncode==0,p.stdout
 new=git('rev-parse','HEAD');stage=f'chore/pr-review-browser-{os.environ["GITHUB_RUN_ID"]}-279'
 git('push','origin',f'{new}:refs/heads/{stage}')
 (OUT/'diff.patch').write_text(git('diff','--binary',HEAD,new)+'\n')
 r={'pr':279,'old':HEAD,'new':new,'stage':stage,'main':MAIN};(OUT/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)
if sys.argv[1]=='prepare':prepare()
elif sys.argv[1]=='publish':publish()
else:raise RuntimeError('Unknown operation')
