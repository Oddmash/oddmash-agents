# Production release process

Keep feature pull requests targeting `main`. Required CI and review remain the same. A merge neither creates a preview deployment nor deploys production automatically.

1. Review all changes accumulated since the last deployed version. Decide the next stable SemVer tag (for example, `v0.2.0` or `v0.2.1`).
2. Prepare release notes from merged pull requests. Use GitHub's generated release notes as a starting point and the Oddmash Release advisor for draft wording, verification and compatibility notes. The Release advisor does not publish or deploy.
3. Publish the GitHub Release manually as the authorized maintainer, targeting the reviewed `main` commit. Use a stable `vMAJOR.MINOR.PATCH` tag. The tag, not the moving branch, identifies the deployed version.
4. The deployment workflow validates the latest published stable release and exact tag commit, checks that the commit belongs to `main` history, runs the full typecheck and tests, stages the Vercel production build, smoke-tests it and promotes only the tested build. The production environment and deployment enable switch still apply.
5. Inspect the workflow summary for the tag, commit and Vercel deployment. If the release failed, the previous production deployment remains assigned. If a newer release has already been published, the old release cannot be redeployed or promoted by this workflow.

For an urgent fix, merge the reviewed patch and publish the next patch release immediately. To retry the latest release if tag-triggered execution is unavailable under the existing production environment rules, run the deployment workflow manually from `main` with the exact published release tag. Never bypass the environment or publish a tag from an unreviewed branch. Leave rollback to the existing authorized Vercel rollback process.

Choose a release cadence based on completed work, not on every commit. Do not publish a new version for documentation or test-only changes unless those changes are part of a user-visible release.
