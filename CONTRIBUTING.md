# Development and local pilot

Requires Node.js 24+. No runtime dependency installation is required. CI runs the offline tests on push and pull requests.

Run `npm test` for offline verification. To review a public PR, configure `OPENAI_API_KEY`, `OPENAI_MODEL` (a model supporting structured outputs), and `ODDMASH_ALLOWED_REPOSITORIES` (comma-separated exact repository names) in your environment using your normal secret manager. An optional read-only `GITHUB_TOKEN` raises public API rate limits. Do not commit credentials.

For the hosted pilot, add `OPENAI_API_KEY` to repository Actions secrets, then use Actions → Reviewer pilot → Run workflow on main with an open Oddmash UI PR number. The workflow uses GPT-5.4, anonymous public repository API requests, and report-only output in the job log. It never posts or executes PR code.

Use the API organization linked to the ChatGPT subscription benefit. The initial available promotional balance is USD 97, with no arbitrary USD 10 monthly cap. Prefer review quality while keeping the existing per-request size and output limits. Verify the grant's expiry and disable automatic recharge in API billing before enabling the pilot. Do not add purchased credits or payment methods for this pilot. The application does not read or guarantee the remaining promotional balance; billing controls must be verified separately. Stop on credit exhaustion rather than retrying against another account.

Run `npm run review -- Oddmash/oddmash-ui 24` with an eligible open PR number. The report is printed locally and does not post. Use a read-only GitHub token for this stage. Model calls may incur API charges; only run against an approved public repository.

For a later comment pilot, explicitly enable `ODDMASH_ALLOW_POST=true`, supply a token scoped to the target repository with pull-request write permission, and add `--post`. This sends an advisory conversation comment only, never a review approval or a blocking status. Serialize runs per repository/PR to prevent concurrent duplicate comments.

Sensitive patterns and size caps are defense-in-depth, not a guarantee that public content has no private data. Review repository policy before opting in. The service excludes private repositories and does not retrieve workflow logs or artifacts. Source patches are sent to the configured model API, with storage disabled in the request. Do not use report outputs as a sole merge decision.
