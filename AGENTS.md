# Oddmash Agents

Follow the organization working agreements in `Oddmash/.github/AGENTS.md` and `docs/AI-CODE-REVIEW.md`.

The reviewer defaults to report-only. A maintainer-authorized, independently identified GitHub App may approve fully reviewed PRs with passing checks, request changes for high-confidence actionable findings, or comment when evidence is incomplete. Reviewer itself remains advisory and must never merge, publish, deploy, execute contributed code, or access repository secrets. The separately gated auto-merge module may squash-merge a maintainer-authored, low-risk public PR only after complete issue-acceptance evidence, exact-head reviewer approval, current CI, and protected-branch checks. Never bypass branch protection. Use explicitly opted-in public repositories, bounded requests, synthetic fixtures, trusted base-branch guidance, validated model output, and no exploit instructions or private values in reports.

Keep tests offline and deterministic. Run `npm test` before delivery.
