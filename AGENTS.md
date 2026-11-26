# Oddmash Agents

Follow the organization working agreements in `Oddmash/.github/AGENTS.md` and `docs/AI-CODE-REVIEW.md`.

The reviewer defaults to report-only. A maintainer-authorized, independently identified GitHub App may approve fully reviewed PRs with passing checks, request changes for high-confidence actionable findings from other authors, or comment when evidence is incomplete. For PRs authored by the verified organization maintainer, publish actionable findings as neutral comments with explicit manual disposition guidance, not formal change requests or approval. Never automatically dismiss prior reviews or bypass branch protection; automatic merge still requires clean exact-head approval. Lead (formerly Reviewer) itself remains advisory and must never merge, publish, deploy, execute contributed code, or access repository secrets. The separately gated auto-merge module may create a normal merge commit for a maintainer-authored PR in an explicitly eligible public or approved private repository limited to ordinary product code, documentation, or additive tests only after complete applicable issue or partial PR-scope acceptance evidence, exact-head reviewer approval, current CI, and protected-branch checks. Never squash or rebase a PR automatically. Wait for the aggregate verify check before submitting an initial review. Submit one automatic full review per PR, even as its head changes; a fresh full review requires an authorized explicit request. Scoped thread follow-up remains available. Publish PR review output in English only. Never bypass branch protection. Use authorized public repositories and the explicitly approved private repository identity allowlist; private reviews retain stricter filtering and only the separately gated module may merge eligible changes. Apply stricter confidential-file and credential-like text exclusions before model requests. Use bounded requests, synthetic fixtures, trusted base-branch guidance, validated model output, and no exploit instructions or private values in reports.

Keep tests offline and deterministic. Run `pnpm test` before delivery.

Repository-specific review check profiles supplement the aggregate `verify` gate with complete CI evidence for a known matrix workflow. Keep profiles in trusted agent source, require every named GitHub Actions job and aggregate `verify` to succeed with trusted app identity, and fail closed on missing or incomplete evidence. They do not replace protected-branch or automatic merge requirements. Separately verified site-only, CLI/integration, and runtime/integration Boundra profiles may start a neutral advisory review when the current PR-associated CI and Pages suites match the pinned scope contract, including deliberately skipped matrix jobs. This exception never permits approval, automatic merge, or verified thread reconciliation. Unrecognized scopes or contract revisions remain fail-closed.

Open agent changes as ready-for-review PRs by default under the organization agreement. Use drafts only for documented exceptions; pending remote CI or bot review is not a draft reason. Do not alter reviewer eligibility or merge gates to compensate for draft status.

## Shared skills

Follow the [skill integration contract](docs/skill-integration.md). Skills supplement trusted organization and product guidance; they do not grant permissions or change review, merge, or deployment policy. Keep approved skill revisions pinned and update them through reviewed pull requests. Do not fetch or inject mutable remote instructions into automated review requests.

## Agent contribution attribution

Follow the [Oddmash agent attribution convention](https://github.com/Oddmash/.github/blob/main/AGENTS.md#agent-contribution-attribution). When a commit materially incorporates a verified finding or recommendation from Lead, Impact, Triage, QA, Release, Docs, or Architect, append the canonical `Co-authored-by` trailer for each actual contributing GitHub account. Deduplicate trailers, preserve human authorship and record the source role or discussion for shared identities. Do not credit unused advice, coordination, or approval alone, and do not rewrite published history. Follow the [Lead identity](docs/lead-identity.md); use the verified current bot login rather than inventing a new Co-authored-by address.

## Delivery workflow

- Use focused branches from the current `main` and target `main` directly for infrastructure changes. The organization product `develop` convention does not apply here. Preserve existing in-flight work and require current-head CI, review, normal merge commits and approved release or deployment policies.
- Find or create a scoped issue before implementation and verify an explicit issue reference in every implementation PR body before opening and at handoff.

- Include a `## Acceptance criteria` section with explicit Markdown task-list entries in each implementation issue before opening a PR. Criteria must describe observable outcomes and remain subject to independent verification.

- Work in parallel when changes are logically independent, even if they touch different sections of the same file. Sequence or stack PRs only when one needs another's behavior or when the changed logic overlaps; record the dependency explicitly. Reconcile actual conflicts against the current base and re-run the required CI before merging.
- Batch related actionable review fixes and their regression tests into a focused push where practical. Respond to optional findings with an evidence-based disposition rather than unnecessary commits or repeated review requests. Preserve required exact-head CI, independent review, and normal merge commits.
- Follow the [production release process and release note format](docs/release-process.md#release-note-format) for every versioned release. Record the actual verification and deployment outcome; never publish or deploy as an advisory agent.

## Console presentation

Follow [the operator console design brief](docs/console-design.md) for user-facing console changes. Record independent rendered acceptance separately from functional CI before substantial presentation changes are considered ready. Preserve authorization and telemetry semantics.
