"""Prepare isolated rebased PR heads; never update original PR branches or main."""
import json, os, pathlib, re, subprocess
ROOT = pathlib.Path.cwd()
REPO = 'NickGuAI/HappyHerd'
MAIN = '4c9454af40581865d43ec08ec90d987d19ab5f68'
EXPECTED = {275:'8369f76340de04e1a328762ef71e4081ef3cc1c8',276:'ddef980e18ffd1b632e871a80c06b5787b480ab9',278:'f17ac6f64b1d0f4b3b6fb126bd916cb584487585',279:'1bda53df273b7a02b5d2837811c0fba3501287e6',280:'b19b37cd0b375477b4a083cd49f9fb02cf9ae99b',282:'3fb0100122516ef837baaf773cc8e2193df6bdd0',284:'c4f226080bc67ddd92caa4dbadb9e251bb3fa78d',285:'2f9893c9f30f5672b2b262f245ae861bd78221ec'}
APP = 'server/packages/happy-app/'
LEDGER = 'docs/owned-patches.tsv'
CHANGELOG = APP+'CHANGELOG.md'
JSONLOG = APP+'sources/changelog/changelog.json'
TOOL = APP+'sources/components/tools/ToolView.tsx'
GENERATED = [APP+'sources/text/ui-surface-inventory.json', APP+'sources/text/ui-tree.html']
CONTRACTS = {
275: 'Owning task: 6aa74c0e8f081102b5269a5b. Proven pre-spawn rejections must finalize and allow the next scheduled tick. Ambiguous starts and historical active runs retain their existing boundary.',
276: 'Owning task: 6aa616c68f084b1907ff2f61. This remains partial: native Codex requestUserInput/plan mapping and full durable answer/replay journeys are not implemented by this revision. ACP plan and Claude form presentation must not be mistaken for full task completion.',
278: 'Owning task: 6aa5e9b58f0815166f75d442, code-submission follow-up. Separate native input/Enter and truthful pending states are the repair boundary. Real authenticated OAuth acceptance and mobile/desktop journey evidence remain separate from deterministic tests.',
279: 'Related issues: #157 and #168. Preserve interrupted queue ownership after a hard limit, without declaring work done or consuming another batch under the rejected account. This does not fix missing stable account identity metadata or prove native cross-account resumption.',
280: 'Owning task: 6aaaaed28f08e0b11c690b06. Preserve exact sessions/native IDs/homes, truthful notice acceptance, and credential provenance without injected work. Shared-home native read/write races and authenticated cross-account resumption remain acceptance gaps.',
282: 'Related issue: #281; task: 6aabee5d7c88912500d4b0cc. Inherit directory, permission and Commander at supported fork and side-chat boundaries, preserving explicit overrides. No new native fork capability for unsupported providers is claimed.',
284: 'Review contract: the PR-described inverted Web chat wheel behavior, preserving OS-delivered deltas, nested scrollers, modifier gestures and horizontal scrolling. An exact standalone owning issue has not yet been established; do not claim unrelated task completion.',
285: 'Related issue: #283. Follow dynamic viewport height for the Web root and zoomed body while retaining older-browser fallbacks. Physical iPhone Chrome toolbar acceptance remains unproved by CSS/source tests.'}

def run(args, cwd=ROOT, check=True):
    p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and p.returncode: raise RuntimeError(f'{args}:\n{p.stdout}')
    return p

def git(*args, cwd=ROOT, check=True): return run(['git', *args], cwd, check)
def api(path): return json.loads(run(['gh','api',f'repos/{REPO}/{path}']).stdout)
def blob(stage, path, cwd): return git('show',f':{stage}:{path}',cwd=cwd).stdout

def sections(s):
    result=[]
    for part in re.split(r'(?m)^# ',s):
        if not part.strip(): continue
        title, body=part.split('\n',1)
        result.append((title.strip(), '# '+title+'\n'+body.rstrip()+'\n\n'))
    assert len(dict(result)) == len(result), 'Duplicate changelog title'
    return result

def resolve_common(path, cwd):
    ours, theirs, base = [blob(i,path,cwd) for i in [2,3,1]]
    if path == LEDGER:
        old=base.splitlines(); right=theirs.splitlines(); left=ours.splitlines()
        assert all(line in right for line in old), 'Non-additive PR ledger edit'
        result=left+[line for line in right if line not in left]
        (cwd/path).write_text('\n'.join(result)+'\n')
    else:
        old=dict(sections(base)); right=dict(sections(theirs)); left=sections(ours)
        assert all(right.get(t)==b for t,b in old.items()), 'Non-additive PR changelog edit'
        additions=[(t,b) for t,b in right.items() if t not in old]
        for title, body in additions:
            assert title not in dict(left), 'Duplicate new changelog title'
            date=re.match(r'September (\d+)',title)
            assert date, 'Unreviewed changelog date format'
            at=0
            while at<len(left):
                other=re.match(r'September (\d+)',left[at][0])
                if not other or int(other[1])<=int(date[1]): break
                at+=1
            left.insert(at,(title,body))
        (cwd/path).write_text(''.join(b for _,b in left).rstrip()+'\n')
    git('add','--',path,cwd=cwd)

def resolve_tool(cwd):
    f=cwd/TOOL; content=f.read_text()
    replacement="""    // Plans and questions retain content; generic pending tools retain approval input.
    const SpecificToolView = isToolIdentityCompatible && hasSpecializedContent ? getToolViewComponent(tool.name) : null;
    const needsApprovalInput = tool.permission?.status === 'pending' && SpecificToolView === null;
    const needsExpandedContent = tool.name === 'TodoWrite'
        || tool.name === 'AskUserQuestion' || tool.name === 'request_user_input'
        || tool.name === 'ExitPlanMode' || tool.name === 'exit_plan_mode';
    const isCompactActivityTool = !needsExpandedContent && !needsApprovalInput
        && (shouldUseCompactToolRow(tool, compactToolCalls, SpecificToolView !== null)
"""
    content,count=re.subn(r'(?ms)^<<<<<<< .*?^>>>>>>> [^\n]*\n',replacement,content)
    assert count==1, f'Unexpected ToolView conflicts: {count}'
    duplicate='        const SpecificToolView = isToolIdentityCompatible && hasSpecializedContent ? getToolViewComponent(tool.name) : null;\n'
    assert content.count(duplicate)==1, 'Unreviewed ToolView content callback'
    content=content.replace(duplicate,'')
    f.write_text(content)
    git('add','--',TOOL,cwd=cwd)

out=pathlib.Path(os.environ['RUNNER_TEMP'])/'prepared-pr-review'; out.mkdir()
git('config','user.name','HappyHerd Maintainers')
git('config','user.email','maintainers@happyherd.example')
assert api('branches/main')['commit']['sha']==MAIN, 'main advanced; review again'
git('fetch','origin','main')
git('remote','add','upstream','https://github.com/slopus/happy.git',check=False)
git('fetch','upstream','main')
report=[]
for n, expected in EXPECTED.items():
    detail=api(f'pulls/{n}'); assert detail['state']=='open' and detail['head']['sha']==expected
    assert detail['head']['repo']['full_name']==REPO and detail['base']['ref']=='main'
    git('fetch','origin',f'refs/pull/{n}/head')
    base=git('merge-base',MAIN,expected).stdout.strip()
    commits=git('rev-list','--reverse',f'{base}..{expected}').stdout.splitlines()
    assert commits and len(commits)<=5
    for sha in commits: assert len(git('rev-list','--parents','-n','1',sha).stdout.split())==2
    cwd=pathlib.Path(os.environ['RUNNER_TEMP'])/f'prepared-{n}'
    git('worktree','add','--detach',str(cwd),MAIN)
    details=[]
    for sha in commits:
        result=git('cherry-pick','--no-commit',sha,cwd=cwd,check=False)
        conflicts=git('diff','--name-only','--diff-filter=U',cwd=cwd).stdout.splitlines()
        assert result.returncode==0 or conflicts, result.stdout
        assert set(conflicts)<={LEDGER,CHANGELOG,JSONLOG,TOOL,*GENERATED}, conflicts
        if TOOL in conflicts: assert n==276; resolve_tool(cwd)
        for path in [LEDGER,CHANGELOG]:
            if path in conflicts: resolve_common(path,cwd)
        if JSONLOG in conflicts:
            git('checkout','--ours','--',JSONLOG,cwd=cwd)
        if CHANGELOG in conflicts or JSONLOG in conflicts:
            run(['bun',APP+'sources/scripts/parseChangelog.ts'],cwd)
            git('add','--',JSONLOG,cwd=cwd)
        if any(p in conflicts for p in GENERATED):
            nm=cwd/APP/'node_modules'; nm.mkdir(exist_ok=True)
            ts=nm/'typescript'; ts.symlink_to(pathlib.Path(os.environ['RUNNER_TEMP'])/'review-tools/node_modules/typescript',target_is_directory=True)
            try: run(['node',APP+'scripts/generate-ui-surface-inventory.mjs','--write'],cwd)
            finally: ts.unlink(); nm.rmdir()
            git('add','--',*GENERATED,cwd=cwd)
        assert not git('diff','--name-only','--diff-filter=U',cwd=cwd).stdout.strip()
        git('diff','--cached','--check',cwd=cwd)
        message=git('show','-s','--format=%B',sha).stdout
        git('cherry-pick','--quit',cwd=cwd,check=False)
        msg=out/f'{n}-message.txt';msg.write_text(message)
        git('commit','--author=HappyHerd Maintainers <maintainers@happyherd.example>','-F',str(msg),cwd=cwd)
        details.append({'original':sha,'prepared':git('rev-parse','HEAD',cwd=cwd).stdout.strip(),'conflicts':conflicts})
    doc=f'.dev/evidence/pr-{n}-review-20260918.md'
    text=f'''# PR #{n} review checkpoint\n\nOriginal head: `{expected}`. Updated comparison base: `{MAIN}`.\n\n{CONTRACTS[n]}\n\n## Integration evidence\n\n- Replayed the existing single-parent topical commits onto the current main, preserving the registered subjects and upstream ancestry.\n- Retained additive changelog and owned-patch entries from both histories. Derived changelog and UI inventory files were regenerated where conflicted.\n- PR #276 combines expanded plan/question content with upstream generic-pending-tool approval visibility; neither side is discarded.\n- Canonical public commit identity is used for the prepared revision.\n- The six required CI gates must execute on the final published head. This checkpoint does not claim those results, authenticated native-provider acceptance, or physical-device acceptance.\n- No main merge, installation, deployment, service/session operation, or task completion is part of this review.\n'''
    (cwd/doc).parent.mkdir(parents=True,exist_ok=True);(cwd/doc).write_text(text)
    git('add','--',doc,cwd=cwd);git('commit','-m',f'docs(review): record PR {n} acceptance boundaries',cwd=cwd)
    run(['node','scripts/lint-source.mjs'],cwd)
    run(['bash','scripts/verify-patch-discipline.sh'],cwd)
    run(['node','scripts/verify-public-boundary.mjs'],cwd)
    prepared=git('rev-parse','HEAD',cwd=cwd).stdout.strip()
    assert api(f'pulls/{n}')['head']['sha']==expected, 'PR advanced; do not publish stale preparation'
    assert api('branches/main')['commit']['sha']==MAIN, 'main advanced; do not publish stale preparation'
    stage=f'chore/pr-review-staging-20260918-{n}'
    git('push','origin',f'{prepared}:refs/heads/{stage}',cwd=cwd)
    entry={'number':n,'original':expected,'prepared':prepared,'branch':detail['head']['ref'],'staging':stage,'commits':details}
    report.append(entry);print(json.dumps(entry),flush=True)
    (out/f'{n}-diff.patch').write_text(git('diff','--binary',MAIN,prepared,cwd=cwd).stdout)
    (out/'prepared.json').write_text(json.dumps(report,indent=2))
    git('worktree','remove','--force',str(cwd))
