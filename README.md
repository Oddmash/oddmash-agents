# Oddmash Agents

Advisory agents for Oddmash products. Lead coordinates specialized agents, identifies concrete regressions in pull requests, and issues the formal review while preserving project-specific conventions and maintainer control.

## Agent family

| | Agent | Responsibility | Execution | Command |
| --- | --- | --- | --- | --- |
| <img src="assets/agents/lead.svg" width="40" alt="Lead badge"> | Oddmash Lead | Coordination, concrete defects and final review | Automatic | `/review` |
| <img src="assets/agents/impact.svg" width="40" alt="Impact badge"> | Oddmash Impact | Product value, necessity and trade-offs | On request | `/impact` |
| <img src="assets/agents/triage.svg" width="40" alt="Triage badge"> | Oddmash Triage | Issue classification, duplicates and priority | On request | `/triage` |
| <img src="assets/agents/qa.svg" width="40" alt="QA badge"> | Oddmash QA | Missing tests and observed verification | On request | `/qa` |
| <img src="assets/agents/release.svg" width="40" alt="Release badge"> | Oddmash Release | Changelog and release note drafts | On request | `/release` |
| <img src="assets/agents/docs.svg" width="40" alt="Docs badge"> | Oddmash Docs | Code and documentation consistency | On request | `/docs` |
| <img src="assets/agents/architect.svg" width="40" alt="Architect badge"> | Oddmash Architect | Design and maintainability assessment | On request | `/architect` |

Lead is the only automatic entry point (currently authenticated as `oddmash-lead[bot]`). Other roles respond to explicit maintainer slash commands and produce advisory output. With optional coordinated review enabled, Lead selects only relevant PR advisors from changed-file metadata within explicit request and time budgets. These reports do not grant approval or merge authority. They share the same server and queue, while role-specific identity, permissions and model usage remain separately configurable. Use `/review` for the formal review and the [slash command table](docs/agent-family.md#slash-commands) for specialist requests. Dedicated apps must be enabled and installed for specialist responses.

See [agent family and setup](docs/agent-family.md) for invocation details and role configuration.

## Lead

Lead coordinates specialized advisors and owns formal review decisions. It independently checks concrete defects and mandatory requirements; optional specialist improvements do not become duplicate Lead findings. See [the identity and attribution guide](docs/lead-identity.md).

Current-head automatic reviews wait for required CI. A new push makes an older review stale until current-head work begins; pending indicates active review. A small verified descendant of an approved head with unchanged base can receive bounded incremental analysis. Incremental reports never authorize a merge; explicit review requests always use full evidence. Missing, divergent, large or unverified comparisons fall back to a full review.

Set `REVIEWER_AUTO_ADVISORY_ENABLED=true` to enable selective additional advisor reports per automatically reviewed head. `REVIEWER_AUTO_ADVISORY_MAX_REQUESTS` bounds attempts (default and hard maximum 5; 0 disables), and `REVIEWER_AUTO_ADVISORY_MAX_MS` bounds the advisory stage (default 90,000 ms, hard maximum 120,000 ms; 0 disables). Small documentation edits and operational or sensitive paths do not trigger coordinated advisors; exact-head and existing file filtering remain in effect. These budgets limit request count and elapsed time, not exact monetary charges. Each enabled dedicated advisor publishes under its own GitHub App identity using its existing repository-scoped installation and per-role model configuration. Unavailable or unauthorized roles are skipped; automatic advice never falls back to the Reviewer account. Triage remains issue-only. No advisor can invoke another advisor. Existing head and role markers prevent duplicate reports, and runtime logs contain role outcomes rather than source or credentials.

- Analyzes open PRs in public and explicitly approved private repositories using GitHub's changed-file and check APIs.
- Uses organization and trusted base-branch root and nested `AGENTS.md` guidance.
- Produces English, evidence-linked, severity-ranked reports and optional inline GitHub Suggested changes; posting is explicitly enabled and deduplicated per finding and commit. Private reviews keep stricter data exclusions, use repository-scoped authentication, and remain subject to separate merge eligibility.
- Never checks out or executes contributor code or modifies source. The advisory reviewer never merges. An independently gated maintainer-only merge module can merge eligible low-risk changes after issue verification, current CI and review approval.

Oddmash operates a maintainer-configured organization GitHub App that can approve fully reviewed changes with passing checks or request changes for high-confidence findings. Independent deployments remain report-only until explicitly configured. Private repository enrollment requires separate maintainer approval, and approved private repositories can use the same separately gated merge policy for eligible low-risk changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and [the rollout plan](docs/rollout.md) for the activation checklist.

Optional authenticated organization guidance reads are default-off. See [shared guidance setup and troubleshooting](docs/shared-guidance.md) for the activation prerequisites, conditional HTTP 304 behavior and stale-cache denial.

## Architecture

Use a single modular serverless application, shared queue and independently configured agent roles. Keep advisory execution separate from approval and merge policy. Shared skills provide guidance, not execution permissions.

```mermaid
flowchart TD
    GitHub["GitHub events and maintainer commands"] --> Intake["Webhook intake"]
    Intake --> Queue["Shared queue when enabled"]
    Queue --> Runtime["Role routing and execution"]
    Intake --> Runtime
    Runtime --> Review["Lead"]
    Runtime --> Advisory["Impact and advisory roles"]
    Review --> Output["GitHub review and comments"]
    Advisory --> Output
    Review --> Gate["Independent merge policy"]
```

The local CLI and organization workflow also use the review engine. Queue-backed execution is optional; neither path replaces repository checks or release policy.

| Component | Responsibility |
| --- | --- |
| [Webhook intake](api/github.ts) and [queue worker](api/review-jobs.ts) | Receive eligible events and coordinate review jobs. |
| [Review orchestration](src/webhook-review.ts) | Coordinate evidence, progress and publication. |
| [Review engine](src/reviewer.ts) and [review model](src/core.ts) | Collect bounded evidence, validate findings and classify outcomes. |
| [Product context](src/review-context.ts) and [CI evidence](src/checks.ts) | Supply project-specific quality criteria and current check results. |
| [Discussion](src/review-discussion.ts), [Impact](src/impact.ts) and [advisory engine](src/advisory.ts) | Support evidence-based follow-up and on-demand role assessments. |
| [Merge policy](src/auto-merge.ts) | Independently verify eligibility before any authorized merge. |
| [Evaluation](src/evaluation.ts) and [offline tests](tests/) | Measure finding accuracy and protect behavior with deterministic fixtures. |

### Evolution

Role-aware execution events and per-role model budgets use the existing runtime logs and a small shared serialization and usage module. See [agent operations](docs/agent-operations.md) for monitoring, limits and cost estimation. Each role retains its own evidence and output validation contract rather than sharing a generalized execution framework.

Defer a dedicated dashboard until logs prove insufficient. Keep cross-agent collaboration explicit and maintainer-directed. Split servers or queues only when measured load, reliability or isolation needs justify the operational cost.

### Development and release

Implement changes on focused branches from `main` and open pull requests directly against `main`. Merge only after current-head CI and review; this repository does not use a `develop` integration branch. Production releases are separate from advisory review. Guarded auto-merge may target `develop` or the default `main` branch only when the existing repository, maintainer, acceptance, low-risk, exact-head CI and branch-protection requirements are satisfied. Incomplete review coverage does not constitute approval.

See [review quality](docs/review-quality.md), [evaluation baseline](docs/evaluation-baseline.md) and [rollout](docs/rollout.md) for operational details.

## Shared guidance

[Oddmash Skills](https://github.com/Oddmash/oddmash-skills) owns reusable work methods. This repository owns executable agents and operational controls. See the [skill integration contract](docs/skill-integration.md) for the approved reference, upgrade procedure, and boundaries.
