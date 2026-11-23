# Actions quota recovery

When a completed GitHub Actions check contains explicit billing-block evidence, the reviewer defers processing and updates its existing review status notice. Missing or ambiguous metadata is not classified as a quota block. Ordinary CI failures must be investigated normally. Required `verify` checks and existing merge gates remain enforced.

1. Open the PR's Checks tab or repository Actions page and locate the current head's failed workflow.
2. An organization owner or billing manager can inspect the applicable Actions budget, included usage, and payment status. Do not disclose account details in a PR. Do not increase spending without maintainer authorization.
3. Wait for the next billing cycle or an authorized billing recovery. Rerun the existing failed jobs from the workflow run; a new commit is unnecessary.
4. Confirm the required aggregate check passed for the exact current head and request a fresh review if event delivery did not resume it.

References: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets).

The classification uses bounded, fixed message patterns from Actions check metadata, not logs or billing APIs. Actual billing events may expose no suitable metadata; in that case the reviewer cannot confirm the cause. For exact-head PR events, the existing opt-in queue retries missing or pending check evidence using its bounded delivery budget. It stops on confirmed quota blocks or completed failures, and never pays for a review until aggregate CI passes. If checks remain missing after the queue retry budget, inspect the failure topic and request verification manually. No scheduled job, billing change, or extra runner is provisioned. Live billing-block metadata and queue recovery still require production verification.
