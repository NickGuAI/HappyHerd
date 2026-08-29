# Development lifecycle and post-merge cleanup

This is the standard lifecycle for an ordinary HappyHerd-owned change.

```text
owning TickTick task → feature branch → PR checks → merge commit
       │                                      └─ main push: Quality + Contract suite
       │                                                    + ancestry → exact cleanup
       └──────────── concise real-transition comments ───────────────────────────────┘

Happy upstream → happyherd-upstream-merge-proposal → deduplicated TickTick proposal
                         └─ unchanged SHA → no write
```

Do not deploy as an implied part of this flow. Releases and deployments have
their own SOPs in `.dev/SOP_INDEX.md`.

## 1. Confirm the owning task, then branch from current main

Before starting, every feature must have an owning TickTick task with the
intended scope stated concisely. Do not start adjacent changes that the owner
did not place in that task.

For any HappyHerd-owned security feature, apply the stop gate in
`.dev/README.md` before selecting implementation details, branching,
implementation, or delegation. Its dedicated TickTick task must be in the list
named exactly `In review`; Nick must explicitly approve the feature; and that
approval's exact text or linked evidence must be recorded in the task. Mere
task creation, list placement, or silence does not count. If either list
placement or approval evidence is missing or ambiguous, stop. An unchanged
upstream Happy security behavior is exempt only when its source path and
upstream commit or range-diff prove that provenance. Removing a HappyHerd-only
security mechanism is also exempt when no replacement security mechanism is
introduced or expanded and upstream Happy behavior remains intact. The
existing repository requirement to record explicit approval in the owning
issue and pull request still applies.

```bash
test -z "$(git status --porcelain --untracked-files=normal)"
git fetch origin
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

FEATURE_BRANCH="type/short-description"
git switch -c "$FEATURE_BRANCH"
```

Use one topical branch. Never use `main`, `prod-release`, or an upstream ref as
a feature branch.

## 2. Develop against the owning contract

1. Route the change with `.dev/ROUTING.md` and inspect couplings.
2. Add or identify a focused test for the violated invariant.
3. Iterate with package-scoped checks from `.dev/VERIFY.md`.
4. For every user-visible change, update the product changelog and regenerate
   its JSON.
5. Stage only reviewed paths; do not use broad staging in a dirty checkout.
6. Keep the owning TickTick task current with concise comments at real
   progress, decision, blocker, PR, and merge transitions. Do not log routine
   command chatter.

Every ordinary owned commit must be single-parent and have a unique
conventional subject. Add a matching ledger row in the same commit unless every
changed path is under `.dev/`:

```bash
COMMIT_SUBJECT="type(scope): describe the owned change"

# Except for a .dev-only commit, add the exact subject to docs/owned-patches.tsv.
git add -- path/to/changed-file path/to/test docs/owned-patches.tsv
git diff --cached --check
git diff --cached
git commit -m "$COMMIT_SUBJECT"
```

Check the configured identity before committing with `git var GIT_AUTHOR_IDENT`.
After committing, `scripts/verify-patch-discipline.sh` verifies the patch/ledger
contract, including the narrow `.dev/`-only exemption, and
`node scripts/verify-public-boundary.mjs` verifies canonical public commit
identity and tracked-content boundaries.

If `origin/main` advances while the PR branch is open, refresh without adding an
ordinary merge commit to the owned patch series:

```bash
git fetch origin main
git rebase origin/main
git push --force-with-lease origin "$FEATURE_BRANCH"
```

Force-with-lease is allowed only for the exact feature branch being refreshed;
never force-push `main`.

## 3. Verify, publish, and merge through the protected branch

Commit first, because the patch verifier and full contract suite require a clean
tree. Run the full local acceptance in `.dev/VERIFY.md`, then publish:

```bash
git push -u origin "$FEATURE_BRANCH"
gh pr create --draft --base main --head "$FEATURE_BRANCH"
```

The PR description records the intended outcome, user-visible or invariant
proof, exact checks run, and any bounded gap. A security-feature PR also records
the dedicated TickTick task and recorded approval evidence; reviewers stop the
PR if either is missing or the implementation exceeds that approval. An
upstream exemption also records the source path and upstream commit or
range-diff that proves the behavior is unchanged. When local evidence is
complete:

```bash
PR_NUMBER="123"
gh pr ready "$PR_NUMBER"
gh pr checks "$PR_NUMBER" --required --watch
```

Resolve review conversations. All six required checks in `.dev/VERIFY.md` must
pass on an up-to-date head. Merge with a GitHub merge commit:

```bash
gh pr merge "$PR_NUMBER" --merge
```

Do not pass `--delete-branch`. The PR head is a recovery pointer until the
ordinary feature-permanence proof succeeds. Record the PR and merge transitions
in the owning TickTick task.

## 4. Capture exact merge evidence

Derive repository identity at runtime so operational identity never enters
tracked documentation:

```bash
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
REPO_OWNER="$(gh repo view --json owner --jq .owner.login)"
EXPECTED_BRANCH="${FEATURE_BRANCH:?set FEATURE_BRANCH to the branch created in step 1}"

STATE="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json state --jq .state)"
BASE="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json baseRefName --jq .baseRefName)"
BRANCH="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefName --jq .headRefName)"
HEAD_OID="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefOid --jq .headRefOid)"
MERGE_OID="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json mergeCommit --jq .mergeCommit.oid)"
HEAD_OWNER="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRepositoryOwner --jq .headRepositoryOwner.login)"
CROSS_REPO="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json isCrossRepository --jq .isCrossRepository)"

test "$STATE" = "MERGED"
test "$BASE" = "main"
test "$CROSS_REPO" = "false"
test "$HEAD_OWNER" = "$REPO_OWNER"
test "$BRANCH" = "$EXPECTED_BRANCH"

case "$BRANCH" in
  ""|main|prod-release) exit 1 ;;
esac
```

Keep `HEAD_OID`, `MERGE_OID`, and `BRANCH` until cleanup is complete. The SHAs
make the branch recoverable even after its name is deleted.

## 5. Prove the change is permanent and main is healthy

```bash
test -z "$(git status --porcelain --untracked-files=normal)"
git fetch --prune origin
git merge-base --is-ancestor "$HEAD_OID" origin/main
git merge-base --is-ancestor "$MERGE_OID" origin/main

git switch main
git pull --ff-only origin main
MAIN_SHA="$(git rev-parse HEAD)"
test "$MAIN_SHA" = "$(git rev-parse origin/main)"
```

GitHub may register push workflows asynchronously. Poll for at most five minutes
to discover both runs, then watch them:

```bash
QUALITY_RUN=""
CONTRACT_RUN=""
DISCOVERY_ATTEMPT=0

while test "$DISCOVERY_ATTEMPT" -lt 30; do
  QUALITY_RUN="$(gh run list \
    --repo "$REPO" \
    --workflow quality-gates.yml \
    --commit "$MAIN_SHA" \
    --event push \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"

  CONTRACT_RUN="$(gh run list \
    --repo "$REPO" \
    --workflow contract-suite.yml \
    --commit "$MAIN_SHA" \
    --event push \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"

  if test -n "$QUALITY_RUN" && test -n "$CONTRACT_RUN"; then
    break
  fi

  DISCOVERY_ATTEMPT=$((DISCOVERY_ATTEMPT + 1))
  sleep 10
done

test -n "$QUALITY_RUN"
test -n "$CONTRACT_RUN"
gh run watch "$QUALITY_RUN" --repo "$REPO" --exit-status
gh run watch "$CONTRACT_RUN" --repo "$REPO" --exit-status

QUALITY_CONCLUSION="$(gh run view "$QUALITY_RUN" \
  --repo "$REPO" \
  --json conclusion \
  --jq .conclusion)"
CONTRACT_CONCLUSION="$(gh run view "$CONTRACT_RUN" \
  --repo "$REPO" \
  --json conclusion \
  --jq .conclusion)"

test "$QUALITY_CONCLUSION" = "success"
test "$CONTRACT_CONCLUSION" = "success"
```

If a newer push advances `origin/main` and cancels these runs, fetch and repeat
the proof for the new current `MAIN_SHA`.

## 6. Delete only the feature-permanent merged PR head

Proceed only after the Quality, `Contract suite`, and ancestry proofs above
pass. Any required-job failure blocks cleanup.

Never bulk-delete every branch listed by `git branch --merged`; long-lived
branches can also be ancestors of `main`.

Delete the exact local PR head with safe ancestry enforcement:

```bash
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git branch -d -- "$BRANCH"
fi
```

Before deleting the remote ref, compare its current object ID with the recorded
PR head. The lease rejects a reused branch name that moved after merge:

```bash
REMOTE_HEAD="$(git ls-remote --heads origin "refs/heads/$BRANCH" \
  | awk 'NR == 1 { print $1 }')"

if test -n "$REMOTE_HEAD"; then
  test "$REMOTE_HEAD" = "$HEAD_OID"
  git push \
    --force-with-lease="refs/heads/${BRANCH}:${HEAD_OID}" \
    origin \
    ":refs/heads/${BRANCH}"
fi
```

A missing remote head is success only after the merged-state, owner, base, and
ancestry proofs above; it may have been deleted by another verified cleanup.
Never delete an external-fork head, `main`, `prod-release`, or an upstream ref.

## 7. Finish with a clean synchronized checkout

```bash
git fetch --prune origin
test -z "$(git ls-remote --heads origin "refs/heads/$BRANCH")"
test "$(git branch --show-current)" = "main"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short --branch
```

The handoff records the PR, merge SHA, Quality and `Contract suite` proof,
deleted local/remote branch name, and final clean/synchronized status. Branch
deletion removes names, not commits; the recorded SHAs and merge commit retain
recovery.
