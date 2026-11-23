# Oddmash Agents

Follow the organization working agreements in `Oddmash/.github/AGENTS.md` and `docs/AI-CODE-REVIEW.md`.

The reviewer defaults to report-only. A maintainer-authorized, independently identified GitHub App may approve fully reviewed PRs with passing checks, request changes for high-confidence actionable findings, or comment when evidence is incomplete. Never merge, publish, deploy, execute contributed code, or access repository secrets. Use explicitly opted-in public repositories, bounded requests, synthetic fixtures, trusted base-branch guidance, validated model output, and no exploit instructions or private values in reports.

Keep tests offline and deterministic. Run `npm test` before delivery.
