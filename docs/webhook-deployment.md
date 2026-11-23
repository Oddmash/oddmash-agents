# Central webhook deployment

The maintainer may opt all public Oddmash repositories into review by enabling the organization webhook. Private, internal, archived, external and draft targets are rejected. No contributor code is executed. Existing relay and scheduled review workflows remain unchanged until live webhook verification.

## Deployment

The unlinked Vercel project is `oddmash-reviewer` in team `qtaghdi`. GitHub Actions builds on reviewed main and uploads prebuilt output. Configure a protected GitHub environment named `production` restricted to main and store a scoped Vercel deployment token as environment secret `VERCEL_TOKEN`. No additional GitHub PAT is needed. Run Deploy Reviewer to Vercel manually once, then set the repository variable `VERCEL_DEPLOY_ENABLED=true` for automatic main deployments. No source or secrets are uploaded as CI artifacts.

In the Vercel production environment set `REVIEWER_APP_ID`, `REVIEWER_APP_SLUG`, `REVIEWER_APP_PRIVATE_KEY`, `OPENAI_API_KEY`, `REVIEWER_WEBHOOK_SECRET` (a new strong shared secret), and `REVIEWER_APP_ENABLED=true`. Keep private values sensitive. Optional `OPENAI_MODEL` defaults to the existing model.

In the Oddmash Reviewer GitHub App, enable the webhook at the project's production HTTPS URL plus `/api/github`, enter the identical webhook secret, and subscribe to Pull request and Check suite events. Keep Contents read, Pull requests write, Checks read, Metadata read. Verify actual installation permissions for label creation. Use a public production domain or explicitly configure protection so GitHub can reach this HMAC-authenticated endpoint; do not expose other deployments.

## Verification and migration

Check a signature-authenticated ping delivery, an ordinary public PR, a fork PR and completed checks. Verify review decisions, labels, and no review for private repositories. Existing review markers reduce duplicate reviews, but concurrent deliveries are not transactionally serialized. Background processing is bounded, not durable; redeliver or run a maintainer manual review after failures. Do not disable old workflows until live verification and a deduplication strategy are in place.
