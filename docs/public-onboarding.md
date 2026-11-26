# Public onboarding

The existing hosted agent service is restricted to explicitly enrolled Oddmash repositories and authorized maintainer operations. An App profile exists, but GitHub's public installation availability and first-use outside Oddmash have not been verified. Public self-service is not supported or advertised. No installation, visibility or permission settings were changed.

## First use as a contributor

Open an eligible public Oddmash pull request, wait for required CI, and inspect the review and inline findings in GitHub. The maintainer controls review commands and merge decisions. A skipped or absent review is not approval. The private console is not a contributor resource.

## First use as a developer

Read [the project development guide](../CONTRIBUTING.md) and run the offline test suite with the pinned Node.js and pnpm versions. It uses synthetic fixtures and does not require installing a GitHub App or providing deployment credentials. Independent pilots are maintainer-configured and report-only by default; they are not the hosted service.

A future public hosted service requires a separately approved enrollment, permission, data-handling and cost policy and verified external first-use path.
