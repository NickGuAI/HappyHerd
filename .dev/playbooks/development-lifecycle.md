# Development lifecycle and post-merge cleanup

This is the standard lifecycle for an ordinary HappyHerd-owned change.

```text
feature branch → PR checks → merge commit → main-push workflows
      │                                              │
      └──────── keep as recovery pointer ────────────┤
                                                     ▼
                         prove PR head ∈ origin/main
                                                     ↓
                           sync main → delete exact PR head
                                                     ↓
                               prune → clean-main proof
```

Do not deploy as an implied part of this flow. Releases and deployments have
their own SOPs in `.dev/SOP_INDEX.md`.

## 1. Start clean and branch from current main

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

Every ordinary owned commit must be single-parent and have a unique
conventional subject with a matching ledger row in the same commit:

```bash
COMMIT_SUBJECT="type(scope): describe the owned change"

# Add a row containing the exact subject to docs/owned-patches.tsv.
git add -- path/to/changed-file path/to/test docs/owned-patches.tsv
git diff --cached --check
git diff --cached
git commit -m "$COMMIT_SUBJECT"
```

Check the configured identity before committing with `git var GIT_AUTHOR_IDENT`.
After committing, `scripts/verify-patch-discipline.sh` verifies the patch/ledger
contract and `node scripts/verify-public-boundary.mjs` verifies canonical public
commit identity and tracked-content boundaries.

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
proof, exact checks run, and any bounded gap. When local evidence is complete:

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
permanent-main proof succeeds.

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

test "$(gh run view "$CONTRACT_RUN" \
  --repo "$REPO" \
  --json jobs \
  --jq '[.jobs[] | select(.name == "Real upstream rehearsal" and .conclusion == "success")] | length')" = "1"
```

If a newer push advances `origin/main` and cancels these runs, fetch and repeat
the proof for the new current `MAIN_SHA`. If either workflow fails, lifecycle
completion is blocked: keep the branch, diagnose the permanent-main failure,
and deliver any correction on a new feature branch. Never rewrite protected
`main` to repair it.

## 6. Delete only the proven merged PR head

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

The handoff records the PR, merge SHA, successful main workflow runs, deleted
local/remote branch name, and final clean/synchronized status. Branch deletion
removes names, not commits; the recorded SHAs and merge commit retain recovery.
