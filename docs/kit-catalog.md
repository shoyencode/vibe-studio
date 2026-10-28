# Official kit catalog

The application and kit catalog are independent repositories. A kit becomes official only after a maintainer
reviews and merges its submission. The workshop never merges its own pull requests.

## Configure a catalog

Copy `catalog-template/` to a dedicated GitHub repository, follow its README and configure repository rules
to require maintainer approval and validation before merging. Publish the catalog before enabling it in the
application. Set `vibeStudio.kits.repository` in `package.json` to its public `owner/repository` name. Without
this setting, **Official kits** explains that the catalog is not configured; local authoring and ZIP/Git
sharing still work. This change does not create or publish a GitHub repository automatically.

The template keeps published `index.json` on a dedicated `catalog-index` branch, not on the protected source
branch. Bootstrap that branch and protect the `catalog-publish` environment with required manual approval as
described in its README. The client reads the published branch; merging unreviewed source alone must not
publish a kit. The workflow does not bypass source-branch protection to commit generated indexes.

The application reads `index.json` anonymously. The repository, index and release assets must be publicly
readable. No personal GitHub credential is used to browse or download kits. Private repositories, rate limits,
invalid indexes and failed downloads produce explicit errors. Cached entries are labelled as cached.

Each entry identifies the kit, version, protocol and minimum application version, license, maintainer, release
asset, size and SHA-256 digest. The application verifies the downloaded bytes before extracting or installing.
A checksum protects against corrupted bytes, not against a compromised publishing account. Manual review is
not a sandbox: installed kit scripts run with the user's project permissions.

## Submit for review

Open the kit in the workshop, check that the header reports it ready, then choose **Share…** in the ⋯ menu and
**Propose to the official catalog**. Both the interface and a
native confirmation explain the remote operations. Submission requires the bundled or installed GitHub CLI
and its own GitHub sign-in, independent of the chosen AI harness.

The application uses an isolated temporary checkout to fork the catalog, create a branch, commit the kit,
push and open a pull request. It does not commit or push the author's source repository. The returned link
opens the review request. Maintainers check licensing, secrets, executable content, instructions, guardrails,
contract compatibility and actual behavior before merging. The catalog template automates packaging after
review, not approval itself.

## Install and update

Installation copies the kit's skills to `.agents/skills`, agents to `.github/agents` and rules to
`.github/instructions`. It records the source, version and hashes of installed files in
`.agents/vibe-studio-kit.json`. Only one kit is supported per project. Unmanaged conflicting files are not
silently replaced. The same installer handles workshop tests, imports and official packages.

Only catalog-managed installations receive automatic update checks, on project opening and at most once per
day. A newer compatible patch release is installed automatically when no project AI turn, paused step,
drafting session or project service is active. Deferred patch updates are retried when the app is idle.
Minor and major releases require explicit confirmation. Locally modified kit files block automatic
replacement; replacing them requires explicit confirmation too.

Before replacing managed files, Vibe Studio keeps a backup under
`%APPDATA%\Vibe Studio\kit-backups`. Updates only replace tracked kit assets. They do not rewrite project
configuration, source documents, deliverables, approvals or user preferences. A local update journal records
the version and whether the update was automatic. The previous kit stays available in the backup.

An incompatible protocol or minimum application version is not offered. Update the application first.
ZIP/local/Git installations are not silently redirected to the official catalog.
