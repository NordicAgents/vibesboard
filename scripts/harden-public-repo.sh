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

# Status check contexts that must pass before a PR can merge. These are the job
# names reported by the workflows in .github/workflows/; renaming a job there
# means renaming it here or the check silently stops being required.
CHECKS='["lint","typecheck","test","e2e","build","security-analysis","complexity-analysis"]'

# A required context that never reports leaves every PR permanently pending —
# there is no timeout, and the only escape is an admin edit of the protection
# rule. That is not hypothetical here: the Security & Quality workflow spent a
# day in `startup_failure` (Actions "allow select actions" refused a
# `uses: docker://…` step), during which both of its contexts would have
# blocked all merges had they been required. So verify each context has
# actually reported on the default branch before requiring it.
verify_contexts_report() {
  local branch head missing=()
  branch=$(gh api "repos/$REPO" --jq .default_branch)
  head=$(gh api "repos/$REPO/commits/$branch" --jq .sha)
  local reported
  reported=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '.check_runs[].name' 2>/dev/null || true)

  local ctx
  while read -r ctx; do
    [ -z "$ctx" ] && continue
    grep -qxF "$ctx" <<<"$reported" || missing+=("$ctx")
  done < <(jq -r '.[]' <<<"$CHECKS")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "WARNING: these contexts did not report on $branch@${head:0:8}:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    echo "Requiring them now would block every merge until they run." >&2
    echo "Fix the workflow first, or drop them from CHECKS. Continue anyway? [y/N]" >&2
    read -r reply
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
  "required_status_checks": { "strict": true, "contexts": $CHECKS },
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

echo "==> Requiring approval for all outside-contributor workflow runs"
gh api -X PUT "repos/$REPO/actions/permissions/access" --input - >/dev/null <<'JSON'
{ "access_level": "none" }
JSON

echo
echo "=== Resulting state ==="
gh api "repos/$REPO" --jq '.security_and_analysis'
for b in main dev; do
  printf '%s: ' "$b"
  gh api "repos/$REPO/branches/$b/protection" \
    --jq '{checks: .required_status_checks.contexts, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled, approvals: .required_pull_request_reviews.required_approving_review_count}'
done
echo
echo "Done. Remaining manual step: in Settings > General, confirm the default"
echo "branch is 'main' and that 'Allow merge commits' is enabled (dev -> main"
echo "must be a merge commit, not a squash — see CLAUDE.md)."
