#!/usr/bin/env bash
# Apply the GitHub protections that only become available once the repository
# is public (this org is on the free plan, where rulesets, branch protection and
# secret scanning are gated behind GitHub Pro OR public visibility).
#
# Run this IMMEDIATELY after flipping the repository to public — between the
# flip and this script, `main` and `dev` accept direct pushes and force-pushes
# from anyone with write access, and pushed credentials are not blocked.
#
# Idempotent: re-running reapplies the same settings.
#
# Usage:
#   ./scripts/harden-public-repo.sh [owner/repo]
set -euo pipefail

REPO="${1:-NordicAgents/vibesboard}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh not found. Install the GitHub CLI." >&2
  exit 1
fi

visibility=$(gh repo view "$REPO" --json visibility --jq .visibility)
if [ "$visibility" != "PUBLIC" ]; then
  echo "Error: $REPO is $visibility. Branch protection and secret scanning are" >&2
  echo "       gated behind GitHub Pro or public visibility on the free plan." >&2
  echo "       Flip the repository to public first, then re-run this script." >&2
  exit 1
fi

# Status check contexts that must pass before a PR can merge. GitHub matches
# these against the job *names* (the `name:` field each job reports as a check
# run), NOT the workflow-file job ids; renaming a job in .github/workflows/
# means renaming it here or the check silently stops being required.
CHECKS='["Lint and format","TypeScript","Unit and integration tests","Playwright suites","Build web application","Secrets, SAST, and vulnerabilities","Complexity regression"]'

# Pin each required check to the GitHub Actions app (app_id 15368) so a
# same-named check reported by any other installed app cannot satisfy the rule.
CHECKS_RS=$(jq -c '[.[] | {context: ., app_id: 15368}]' <<<"$CHECKS")

# A required context that never reports leaves every PR permanently pending —
# there is no timeout, and the only escape is an admin edit of the protection
# rule. That is not hypothetical here: the Security & Quality workflow spent a
# day in `startup_failure` (Actions "allow select actions" refused a
# `uses: docker://…` step), during which both of its contexts would have
# blocked all merges had they been required. So verify each context has
# actually reported on the default branch before requiring it.
verify_contexts_report() {
  local head missing=()
  # PR-triggered workflows attach their check runs to the PR *head* SHA. The
  # commit that lands on the default branch is a fresh squash-merge SHA that
  # only push-triggered workflows (Security & Quality, deploys) ever ran on,
  # so checking the branch head would report most contexts "missing" on a
  # perfectly healthy repo. Verify against the last merged PR's head instead.
  head=$(gh pr list -R "$REPO" --state merged --limit 1 --json headRefOid --jq '.[0].headRefOid' 2>/dev/null || true)
  if [ -z "$head" ] || [ "$head" = "null" ]; then
    head=$(gh api "repos/$REPO/commits/$(gh api "repos/$REPO" --jq .default_branch)" --jq .sha)
  fi
  local reported
  reported=$(gh api "repos/$REPO/commits/$head/check-runs" --paginate --jq '.check_runs[].name' 2>/dev/null || true)

  local ctx
  while read -r ctx; do
    [ -z "$ctx" ] && continue
    grep -qxF "$ctx" <<<"$reported" || missing+=("$ctx")
  done < <(jq -r '.[]' <<<"$CHECKS")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "WARNING: these contexts did not report on ${head:0:8} (last merged PR head):" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    echo "Requiring them now would block every merge until they run." >&2
    echo "Fix the workflow first, or drop them from CHECKS. Continue anyway? [y/N]" >&2
    read -r reply || reply=""
    [[ "$reply" =~ ^[Yy]$ ]] || exit 1
  fi
}

verify_contexts_report

protect_branch() {
  local branch="$1"
  local reviewers="$2"
  echo "==> Protecting $branch (required approvals: $reviewers)"
  gh api -X PUT "repos/$REPO/branches/$branch/protection" \
    --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "checks": $CHECKS_RS },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": $reviewers,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON
}

# `main` is the release branch; `dev` is where feature PRs land. Both refuse
# force-pushes and deletion, which is the protection that actually matters for a
# public repo. enforce_admins stays false so a solo maintainer is not locked out
# of an emergency fix — turn it on once there is a second maintainer.
#
# required_linear_history is false on purpose: CLAUDE.md requires dev -> main to
# be a real merge commit, and linear history would forbid exactly that.
protect_branch main 1
protect_branch dev 1

echo "==> Enabling secret scanning and push protection"
gh api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "secret_scanning_non_provider_patterns": { "status": "enabled" }
  }
}
JSON

echo "==> Enabling private vulnerability reporting"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null

echo "==> Enabling Dependabot alerts and automated security fixes"
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null
gh api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null

echo "==> Restricting workflow permissions to read-only by default"
gh api -X PUT "repos/$REPO/actions/permissions/workflow" --input - >/dev/null <<'JSON'
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false
}
JSON

echo "==> Requiring approval for workflow runs from all outside collaborators"
gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --input - >/dev/null <<'JSON'
{ "approval_policy": "all_external_contributors" }
JSON

# `actions/permissions/access` governs cross-repo reuse of this repo's
# workflows and only exists for PRIVATE repositories — on a public repo GitHub
# rejects the call. Keep it non-fatal (and after the fork-PR approval above,
# which is the control that actually matters) so a rejection can never abort
# the hardening run under `set -e`.
echo "==> Blocking other repositories from using this repo's workflows (private-repo setting)"
if ! gh api -X PUT "repos/$REPO/actions/permissions/access" -f access_level=none >/dev/null 2>&1; then
  echo "    skipped: not applicable to public repositories"
fi

echo "==> Enabling Discussions (issue templates link to it) and auto branch deletion"
gh api -X PATCH "repos/$REPO" -F has_discussions=true -F delete_branch_on_merge=true >/dev/null

echo "==> Verifying the Actions allow-list still permits required third-party actions"
# "allowed_actions: selected" once put Security & Quality in startup_failure
# for a day (see the comment above CHECKS). If either pattern disappears, the
# workflows that use it stop even starting — and produce no logs.
allowed=$(gh api "repos/$REPO/actions/permissions/selected-actions" --jq '.patterns_allowed[]?' 2>/dev/null || true)
for pattern in "Uno-Takashi/Lizard-Runner" "treosh/lighthouse-ci-action"; do
  grep -qF "$pattern" <<<"$allowed" \
    || echo "WARNING: Actions allow-list no longer permits $pattern — workflows using it will fail at startup with no logs." >&2
done

echo
echo "=== Resulting state ==="
gh api "repos/$REPO" --jq '.security_and_analysis'
for b in main dev; do
  printf '%s: ' "$b"
  gh api "repos/$REPO/branches/$b/protection" \
    --jq '{checks: .required_status_checks.contexts, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled, approvals: .required_pull_request_reviews.required_approving_review_count}'
done
echo
echo "Done. Remaining manual steps:"
echo "  - Settings > Environments > production: add required reviewers and keep"
echo "    the deployment branch policy restricted (see docs/deployment.md)."
echo "  - Settings > General: confirm 'Allow merge commits' is enabled"
echo "    (dev -> main must be a merge commit, not a squash — see CLAUDE.md)."
echo "  - The default branch stays 'dev' (the PR target); only switch it once"
echo "    that decision is made deliberately."
