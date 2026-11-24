# Oddmash Agents

Follow the organization working agreements in `Oddmash/.github/AGENTS.md` and `docs/AI-CODE-REVIEW.md`.

The reviewer defaults to report-only. A maintainer-authorized, independently identified GitHub App may approve fully reviewed PRs with passing checks, request changes for high-confidence actionable findings, or comment when evidence is incomplete. Reviewer itself remains advisory and must never merge, publish, deploy, execute contributed code, or access repository secrets. The separately gated auto-merge module may create a normal merge commit for a maintainer-authored PR in an explicitly eligible public or approved private repository limited to ordinary product code, documentation, or additive tests only after complete applicable issue or partial PR-scope acceptance evidence, exact-head reviewer approval, current CI, and protected-branch checks. Never squash or rebase a PR automatically. Wait for the aggregate verify check before submitting a final review; refresh an existing advisory for the same head instead of posting a duplicate. Never bypass branch protection. Use authorized public repositories and the explicitly approved private repository identity allowlist; private reviews retain stricter filtering and only the separately gated module may merge eligible changes. Apply stricter confidential-file and credential-like text exclusions before model requests. Use bounded requests, synthetic fixtures, trusted base-branch guidance, validated model output, and no exploit instructions or private values in reports.

Keep tests offline and deterministic. Run `pnpm test` before delivery.

Repository-specific review check profiles supplement the aggregate `verify` gate with complete CI evidence for a known matrix workflow. Keep profiles in trusted agent source, require every named GitHub Actions job and aggregate `verify` to succeed with trusted app identity, and fail closed on missing or incomplete evidence. They do not replace protected-branch or automatic merge requirements.

Open agent changes as ready-for-review PRs by default under the organization agreement. Use drafts only for documented exceptions; pending remote CI or bot review is not a draft reason. Do not alter reviewer eligibility or merge gates to compensate for draft status.

## Shared skills

Follow the [skill integration contract](docs/skill-integration.md). Skills supplement trusted organization and product guidance; they do not grant permissions or change review, merge, or deployment policy. Keep approved skill revisions pinned and update them through reviewed pull requests. Do not fetch or inject mutable remote instructions into automated review requests.

## Agent contribution attribution

Follow the [Oddmash agent attribution convention](https://github.com/Oddmash/.github/blob/main/AGENTS.md#agent-contribution-attribution). When a commit materially incorporates a verified finding or recommendation from Reviewer, Impact, Triage, QA, Release, Docs, or Architect, append the canonical `Co-authored-by` trailer for each actual contributing GitHub account. Deduplicate trailers, preserve human authorship and record the source role or discussion for shared identities. Do not credit unused advice or rewrite published history.

## Delivery workflow

- Use focused branches from the current `main` and target `main` directly for infrastructure changes. The organization product `develop` convention does not apply here. Preserve existing in-flight work and require current-head CI, review, normal merge commits and approved release or deployment policies.
- Find or create a scoped issue before implementation and verify an explicit issue reference in every implementation PR body before opening and at handoff.

- Include a `## Acceptance criteria` section with explicit Markdown task-list entries in each implementation issue before opening a PR. Criteria must describe observable outcomes and remain subject to independent verification.
