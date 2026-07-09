# Branch Protection Rules for Aira

# This file documents the required branch protection configuration
# for the Aira repository. Apply these rules via GitHub UI (Settings >
# Branches > Branch protection rules) or via the API.

# Apply to: main (default branch)

rules:
  # 1. Require a pull request before merging
  required_pull_request_reviews:
    required_approving_review_count: 1
    dismiss_stale_reviews: true
    require_code_owner_reviews: true
    require_last_push_approval: true
    # Dismiss approvals when new commits are pushed
    # Ensures reviewers re-approve after changes

  # 2. Require signed commits
  required_signatures: true
  # Enforces commit signing via GPG, SSH, or S/MIME
  # Rejects unsigned commits at push time

  # 3. Require status checks to pass before merging
  required_status_checks:
    strict: true
    # Require branches to be up to date before merging
    contexts:
      - "npm audit"
      - "TypeScript typecheck"
      - "gitleaks secret scan"
      - "Build"
      - "Security Checks / npm-audit"
      - "Security Checks / typecheck"
      - "Security Checks / gitleaks"
      - "Security Checks / build"

  # 4. Block force pushes
  allow_force_pushes: false
  # Prevents rewriting branch history on the protected branch

  # 5. Block branch deletion
  allow_deletions: false
  # Prevents accidental or malicious deletion of the main branch

  # 6. Require conversation resolution before merging
  required_conversation_resolution: true
  # Ensures all review threads are resolved before merge

  # 7. Restrict who can push to matching branches
  # push_restrictions:
  #   - "rambur/security-engineering"

  # 8. Require linear history (optional — reduces merge complexity)
  # required_linear_history: true

  # 9. Do not allow bypassing the above settings
  # (Admins can be configured separately)
  # enforce_admins: false

# ---
# How to apply:
#
# Option A: GitHub UI
#   1. Go to Settings > Branches
#   2. Add rule for branch name pattern: "main"
#   3. Apply all settings above
#
# Option B: GitHub API
#   PUT /repos/{owner}/{repo}/branches/main/protection
#   See: https://docs.github.com/en/rest/branches/branch-protection
#
# Option C: Terraform (github_branch_protection resource)
#   See: https://registry.terraform.io/providers/integrations/github/latest/docs/resources/branch_protection
#
# Option D: github/safe-settings app
#   Points to .github/settings.yml in the default branch