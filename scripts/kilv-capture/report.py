"""Build the review index from captured screenshots and explicit source coverage."""
from pathlib import Path
from collections import defaultdict
from urllib.parse import quote
import csv
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / 'docs/acceptance/issue-287/panels'
UI_BASE = '189c504b5ab16eea7fa16e3c2fb33e98d147390d'
UI_HEAD = 'a38fae51c2f99d34bc4d81b24ccfd4c7aa611b05'
PREFIX = 'server/packages/happyherd-app/sources/'
GROUPS = ['production', 'routes', 'chat', 'workspace']


def source_path(path):
    return path.removeprefix(PREFIX).removeprefix('sources/')


def url(path):
    return quote(str(path), safe='/#-_.')


def cell(text):
    return str(text).replace('|', '\\|').replace('\n', ' ')


def change_description(panel):
    if panel.get('changeDescription'):
        return panel['changeDescription']
    named = {
        'landing': 'KILV welcome artwork, warm light/dark backgrounds, Space Grotesk headings and shared primary actions.',
        'restore-key': 'Themed secret-key form, readable mobile input and KILV restore action.',
        'restore-device': 'KILV pairing instructions and alternate restore action; offline pairing state is shown.',
        'server-config': 'KILV grouped server form, URL input and readable settings actions.',
        'changelog': 'KILV release-note typography and grouped Markdown surfaces, including the terminal input layout fix.',
        'artifacts': 'Space Grotesk artifact-list copy and KILV list/empty-state presentation.',
        'artifact': 'KILV artifact title, metadata and rendered content presentation.',
        'artifact-new': 'KILV typography and themed input/editor presentation for a new artifact.',
        'artifact-edit': 'KILV typography and themed input/editor presentation for an existing artifact.',
        'friends': 'KILV friend-list typography and grouped row presentation.',
        'friend-search': 'KILV search field, result rows and friend actions.',
        'inbox': 'KILV inbox headings, activity rows and secondary text hierarchy.',
        'machine': 'KILV machine settings groups, readable paths and machine action presentation.',
    }
    if panel['panelId'] in named:
        return named[panel['panelId']]
    files = ' '.join(panel['sourcePaths']).lower()
    if 'restore' in files or 'account' in files or 'credential' in files:
        return 'KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs.'
    if 'tool' in files or 'markdown' in files or 'message' in files:
        return 'KILV message/tool surfaces, warm reply islands, semantic status colors and UI/code typography.'
    if 'workspace' in files or 'file' in files or 'codeeditor' in files or 'diff' in files:
        return 'KILV panel/tab borders and actions, code/data typography, readable file/review surfaces.'
    if 'sidebar' in files or 'project' in files or 'session' in files:
        return 'KILV navigation/row surfaces, shared typography, compact controls and semantic status treatment.'
    if 'settings' in files or 'usage' in files:
        return 'KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.'
    return 'Shared KILV palette, typography, border geometry and interactive control styling.'


def main():
    changed = subprocess.check_output(['git', 'diff', '--name-only', UI_BASE, UI_HEAD, '--', PREFIX], cwd=ROOT, text=True).splitlines()
    changed = sorted(source_path(p) for p in changed if p.endswith('.tsx') and '/__testdata__/' not in p)
    records = []
    gaps = []
    coverage = defaultdict(list)
    panel_rows = []
    errors = []
    for group in GROUPS:
        directory = ARTIFACTS / group
        manifest = directory / 'manifest.json'
        if not manifest.exists():
            errors.append(f'Missing {manifest.relative_to(ROOT)}')
            continue
        data = json.loads(manifest.read_text())
        gap_file = directory / 'gaps.json'
        if gap_file.exists():
            gap_data = json.loads(gap_file.read_text())
            if isinstance(gap_data, dict):
                gap_data = gap_data.get('gaps', [])
            gaps.extend(dict(item, group=group) for item in gap_data)
        panels = defaultdict(list)
        for record in data:
            artifact = directory / record['filename']
            if not artifact.is_file() or artifact.stat().st_size < 1000:
                errors.append(f'Missing/empty screenshot: {artifact.relative_to(ROOT)}')
            if record.get('pageErrors'):
                errors.append(f'Runtime error: {record["panelId"]}')
            if record['evidenceType'] not in ['production-export', 'component-fixture']:
                errors.append(f'Unknown proof plane: {record["panelId"]}')
            if record['evidenceType'] == 'component-fixture':
                environment_path = directory / record.get('environment', '__missing_environment__')
                if not environment_path.is_file():
                    errors.append(f'Missing fixture environment: {record["panelId"]}')
                else:
                    environment = json.loads(environment_path.read_text())
                    real_sources = {source_path(path) for path in environment['sourceInputs']}
                    for path in record['sourcePaths']:
                        if source_path(path) not in real_sources:
                            errors.append(f'Claimed owner absent from real source graph: {record["panelId"]}: {path}')
            record = dict(record, group=group, artifact=str(artifact.relative_to(ROOT)))
            records.append(record)
            panels[record['panelId']].append(record)
        lines = [f'# {group.title()} panel screenshots', '',
                 f'Production source revision: `{UI_HEAD}`. These are after-change screenshots for [PR #289](https://github.com/NickGuAI/HappyHerd/pull/289).', '',
                 '**Evidence boundary:** production-export means the actual exported Web UI on an isolated local host with its backend offline. Component-fixture means real production components with synthetic service/state boundaries and documented Web platform adapters. Neither proves authenticated live journeys, physical iPhone behavior, or installed native clients.', '']
        contacts = sorted(directory.glob('contact*.*'))
        if contacts:
            lines += ['Overview sheets: '+', '.join(f'[{p.stem}]({url(p.name)})' for p in contacts)+'. Original full-resolution screenshots remain linked per panel below.', '']
        for panel_id, variants in panels.items():
            sample = variants[0]
            label = sample.get('label', panel_id)
            anchor = 'panel-' + panel_id
            index_link = f'acceptance/issue-287/panels/{group}/README.md#{anchor}'
            panel_rows.append((group, panel_id, label, change_description(sample), sample['evidenceType'], len(variants), index_link))
            lines += [f'<a id="{anchor}"></a>', f'## {label}', '',
                      f'**Changed presentation:** {change_description(sample)}', '',
                      f'**Evidence:** `{sample["evidenceType"]}`. States: '+', '.join(sorted({v.get('state','default') for v in variants}))+'.', '',
                      '**Production owners:** '+', '.join(f'`{source_path(p)}`' for p in sample['sourcePaths'])+'.', '']
            limits = list(dict.fromkeys(limit for v in variants for limit in v.get('limitations', [])))
            lines += [f'- {limit}' for limit in limits] + ['']
            environments = sorted({v.get('environment') for v in variants if v.get('environment')})
            if environments:
                lines += ['Fixture environment: '+', '.join(f'[source graph and adapters]({url(p)})' for p in environments)+'.', '']
            lines += ['| State | Theme | Viewport | Screenshot |', '|---|---|---|---|']
            for v in variants:
                viewport = v['viewport']
                dimensions = f'{viewport["width"]}×{viewport["height"]}'
                image_url = url(v['filename'])
                lines.append(f'| {cell(v.get("state","default"))} | {v["theme"]} | {dimensions} | [Open full screenshot]({image_url}) |')
                for path in v['sourcePaths']:
                    key = source_path(path)
                    if (group, panel_id, index_link, v['evidenceType']) not in coverage[key]:
                        coverage[key].append((group, panel_id, index_link, v['evidenceType']))
            lines += ['', '<details>', '<summary>Show every screenshot for this panel</summary>', '']
            for v in variants:
                dimensions = f'{v["viewport"]["width"]}×{v["viewport"]["height"]}'
                lines += [f'**{v.get("state","default")} · {v["theme"]} · {dimensions}**', '',
                          f'<a href="{url(v["filename"])}"><img src="{url(v["filename"])}" alt="{cell(label)} {v["theme"]} {dimensions}" width="360"></a>', '']
            lines += ['</details>', '']
        (directory / 'README.md').write_text('\n'.join(lines))

    uncovered = [p for p in changed if p not in coverage]
    summary = {'sourceRevision':UI_HEAD, 'directChangedProductionTsx':len(changed),
               'mappedDirectChangedProductionTsx':len(changed)-len(uncovered), 'unmappedDirectChangedProductionTsx':uncovered,
               'panelCount':len(panel_rows), 'screenshotCount':len(records),
               'productionExportScreenshots':sum(r['evidenceType']=='production-export' for r in records),
               'componentFixtureScreenshots':sum(r['evidenceType']=='component-fixture' for r in records),
               'explicitGaps':gaps, 'artifactErrors':errors}
    (ARTIFACTS/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    with (ARTIFACTS/'source-coverage.tsv').open('w') as file:
        writer=csv.writer(file,delimiter='\t',lineterminator='\n')
        writer.writerow(['production_source','state','panels','evidence_types'])
        for path in changed:
            writer.writerow([PREFIX+path,'screenshot' if path in coverage else 'unproved',
                             '; '.join(f'{g}/{p}' for g,p,_,_ in coverage[path]) or '-',
                             '; '.join(sorted({e for _,_,_,e in coverage[path]})) or '-'])
    lines=['# PR #289 — per-panel screenshot review', '',
           'Reviewer request: [PR comment, September 20, 2026](https://github.com/NickGuAI/HappyHerd/pull/289#issuecomment-5746628262): “for verification, we should attach screenshot of each modified panels.”', '',
           f'This index maps **{len(panel_rows)} panels / {len(records)} screenshots** to the actual production sources changed by the KILV rebuild. The direct TSX reconciliation covers **{len(changed)-len(uncovered)} of {len(changed)} changed files** with screenshots; every remaining file is named below. Several files form one visible panel; shared controls can appear in more than one panel. A source imported into a bundle is not by itself a coverage claim—the table names the scene where the owner is visibly rendered.', '',
           f'**Source boundary:** UI diff `{UI_BASE[:8]}..{UI_HEAD[:8]}`. Screenshot scripts and fixtures add review evidence without changing production UI. Shared theme, font, style and packaging changes are represented by their consuming panels; this index complements the [945-path disposition](issue-287-ui-disposition.tsv).', '',
           '## Evidence types', '',
           f'- **Production export:** {summary["productionExportScreenshots"]} images from the actual exported Web app, including its real Unistyles runtime and route shell. The local host has no authenticated backend. Restore QR ready/success is unproved.',
           f'- **Component fixture:** {summary["componentFixtureScreenshots"]} images of production components with synthetic account/session/project/automation data. Real theme, Typography, font files and Expo vector-icon glyphs are retained. Some neighboring avatar/provider/status renderers are fixture replacements and are not claimed as their own visual evidence. Environment records name every mocked module, native bridge and the real source graph.',
           '- **Native/live gaps:** Web emulation and DOM rendering of native source do not prove installed iOS/Android/macOS/Windows clients, physical Safari keyboard/zoom or authenticated live workflows. The existing [journey acceptance matrix](issue-287-ui-acceptance.md) remains separate.', '',
           '## Panel index', '', '| Group | Panel | Changed presentation | Evidence | Images |', '|---|---|---|---|---|']
    for group,panel,label,change,plane,count,link in panel_rows:
        lines.append(f'| {group} | [{cell(label)}]({url(link)}) | {cell(change)} | `{plane}` | {count} |')
    lines += ['', '## Directly changed source coverage', '',
              '[Machine-readable source table](acceptance/issue-287/panels/source-coverage.tsv) · [Capture summary](acceptance/issue-287/panels/summary.json)', '',
              '| Production source | Visible panel evidence |', '|---|---|']
    for path in changed:
        links=', '.join(f'[{g}/{p}]({url(link)})' for g,p,link,_ in coverage[path]) or '**Unproved — see gaps below**'
        lines.append(f'| `{path}` | {links} |')
    lines += ['', '## Specific unproved panels and prerequisites', '']
    for gap in gaps:
        owner = gap.get('sourcePath') or gap.get('panelId') or gap.get('surface') or ', '.join(gap.get('sourcePaths', [])) or gap['group']
        reason = gap.get('reason') or gap.get('limitation') or gap.get('evidenceNeeded') or 'See the group evidence record.'
        lines.append(f'- **{cell(owner)}:** {cell(reason)}')
    for path in uncovered:
        lines.append(f'- `{path}` has no screenshot coverage in this set. A rendered target host is still needed; another panel screenshot is not a substitute.')
    if not uncovered:
        lines.append('- Every directly changed TSX owner has a screenshot mapping; native/live limitations still apply individually as described in each panel gallery.')
    lines += ['- **Mobile-device pairing / QR ready state:** the production route is captured with an offline backend. A ready QR and completed pairing require a test server/account; neither is shown as verified.',
              '- **Native Markdown, native CodeEditor and voice Shimmer:** their source has DOM fixture screenshots, but native font metrics, selection/keyboard integration, alpha-mask animation and glass compositing require the installed native host.',
              '- **Installed-client shells and splash:** desktop/native window chrome, iOS/Android safe areas and the physical Safari keyboard/zoom behavior require their actual devices. Web panel screenshots do not substitute for those checks.']
    lines += ['', '## Visual findings retained in the evidence', '',
              '- **UsageChart:** the fixture exposes clipping at the top of tall bars and their value labels. The baseline `189c504b` has the same height/padding/bar-height geometry; this UI diff changes its font and semantic colors.',
              '- **ConnectButton:** the action label remains shortened inside its fixed-width button, as in the bounded historical comparison. Screenshot review also exposed a new URL-input overflow caused by the larger monospace field; `a38fae51` fixes it with `minWidth: 0` while retaining 16px text. The [before/after evidence and measurements](acceptance/issue-287/connect-input-regression/README.md) document the fix. Final panel screenshots show the repaired input.',
              'The original screenshots retain these findings. They are not marked as clean visual passes or silently corrected in the capture adapters.']
    lines += ['', '## Reproduce', '',
              'Run capture scripts from the dedicated repository worktree with the pinned workspace dependencies installed. Production capture requires the current exported Web artifact; it starts and removes its own loopback static server. All fixture data is synthetic.', '',
              '```sh', 'node scripts/kilv-capture/production.mjs /path/to/expo-export',
              'node scripts/kilv-capture/routes.mjs', 'node scripts/kilv-capture/chat.mjs',
              'node scripts/kilv-capture/workspace.capture.mjs', 'python3 scripts/kilv-capture/report.py', '```', '',
              'No deployed revision, authenticated account, merge, deployment, service restart or reviewer-comment reply is implied by this evidence update.', '']
    (ROOT/'docs/issue-287-panel-screenshots.md').write_text('\n'.join(lines))
    print(json.dumps({k:v for k,v in summary.items() if k!='explicitGaps'},indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
