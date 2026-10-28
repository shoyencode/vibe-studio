# Kit catalog repository template

This template is not a published or reviewed catalog. Create a separate public
GitHub repository, replace `OWNER` in CODEOWNERS, protect the default branch,
require code-owner review and the validation check, and enable Actions with
read-only default permissions. Configure Vibe Studio's `vibeStudio.kits.repository`
only after maintainers have reviewed this repository and its publication policy.
No repository configuration means the app catalog remains disabled.

Before enabling CI, create a `catalog-index` branch containing the initial
`index.json`. Protect `main` against direct pushes, including automation. Grant
the publisher write access only to `catalog-index` and releases. Create the
`catalog-publish` GitHub environment with required maintainer reviewers and restrict
it to the protected `main` branch. Without these protections the template does not
enforce human review by itself. The app reads `index.json` from `catalog-index`.

Submit packages under `kits/<id>/`: `apm.yml`, `.apm/`, README and license.
The APM name must match the directory id. Use stable semantic versions, protocol
2 and a `minVibeStudio` field in `catalog.json` alongside `maintainer`.
Example: `{"minVibeStudio":"3.0.0","maintainer":"github-login"}`.
Keep previous releases immutable; every package change needs a higher version.

PR CI runs only the trusted base-branch validator and schemas, never submitted
scripts, actions or dependencies. It does not prove a kit safe. Review all skills,
agents, scripts, dependencies, model policies, network access and licences manually.
The checklist is mandatory. Changes to workflows, schemas and publishing scripts
require a separate infrastructure review; do not combine them with kit submissions.

On a reviewed merge and environment approval, the publisher builds ZIPs, publishes
repository-bound `kit-<id>-v<version>` releases and SHA-256 checksums, then updates
`index.json` on `catalog-index` only. It never commits or pushes to `main`.
CI compares package versions against this published index and compares the entire
PR package tree against the trusted base, not merely its last commit.
Enable write permissions for this workflow only. No GitHub credentials are
included in packages. Review the first publication in a test repository.

Local validation: `python -m pip install -r requirements.txt`, then
`python scripts/validate.py .`. Publication uses the authenticated GitHub CLI
and `GITHUB_REPOSITORY`; run `python scripts/publish.py SOURCE PUBLISHED/index.json`
only in the trusted default-branch workflow.
