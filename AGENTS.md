# Oddmash Agents

Follow the organization working agreements in `Oddmash/.github/AGENTS.md` and `docs/AI-CODE-REVIEW.md`.

The reviewer defaults to report-only. A maintainer-authorized, independently identified GitHub App may approve fully reviewed PRs with passing checks, request changes for high-confidence actionable findings, or comment when evidence is incomplete. Reviewer itself remains advisory and must never merge, publish, deploy, execute contributed code, or access repository secrets. The separately gated auto-merge module may create a normal merge commit for a maintainer-authored PR in an explicitly eligible public or approved private repository limited to ordinary product code, documentation, or additive tests only after complete issue-acceptance evidence, exact-head reviewer approval, current CI, and protected-branch checks. Never squash or rebase a PR automatically. Wait for the aggregate verify check before submitting a final review; refresh an existing advisory for the same head instead of posting a duplicate. Never bypass branch protection. Use authorized public repositories and the explicitly approved private repository identity allowlist; private reviews retain stricter filtering and only the separately gated module may merge eligible changes. Apply stricter confidential-file and credential-like text exclusions before model requests. Use bounded requests, synthetic fixtures, trusted base-branch guidance, validated model output, and no exploit instructions or private values in reports.

Keep tests offline and deterministic. Run `npm test` before delivery.

## Shared skills

Follow the [skill integration contract](docs/skill-integration.md). Skills supplement trusted organization and product guidance; they do not grant permissions or change review, merge, or deployment policy. Keep approved skill revisions pinned and update them through reviewed pull requests. Do not fetch or inject mutable remote instructions into automated review requests.
