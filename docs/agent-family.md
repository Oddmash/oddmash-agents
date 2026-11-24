# Oddmash agent family

One repository, Vercel project and queue serve the agents. Each role has individual usage attribution and optionally independent model configuration. Reviewer retains its existing automatic review policy. Other agents primarily respond to explicit maintainer commands and publish advice, not approval or operational actions. The optional coordinated review mode selects relevant PR advisors only within the configured request and elapsed-time budgets; Triage remains issue-only. A small documentation-only edit needs no automatic advisor, a UI feature can select Impact and QA, an API change can also select Docs, and structural or release changes can select Architect or Release. The deterministic priority order resolves a limited budget without recursively invoking agents. See [agent operations](agent-operations.md) for limits.

| Role | Target | Command | Output |
| --- | --- | --- | --- |
| Reviewer | PR | `/review` | Existing code review workflow |
| Impact | PR | `/impact` | Value, product fit, cost and trade-offs |
| Triage | Issue | `/triage` | Classification, priority, related issues and next steps |
| QA | PR | `/qa` | Observed CI, test coverage and missing scenarios |
| Release | PR | `/release` | Release note draft and version impact |
| Docs | PR | `/docs` | Documentation changes and examples |
| Architect | PR | `/architect` | Design, trade-offs and maintainability |

For explicit manual requests until independent apps are configured, invoke each advisory role with `@oddmash-reviewer[bot] /<role>`. Once configured, use `@oddmash-<role>[bot] /<role>`. Do not invoke both for the same assessment. Each role uses one updatable bilingual advisory for its own authenticated identity and evidence snapshot. It does not alter labels, issue state, checks, release or merge decisions.

For coordinated automatic requests, Reviewer resolves the selected role's own enabled App installation for the repository and uses that role's existing scoped token. Unavailable, unconfigured or unauthorized roles are skipped, with no fallback publication under Reviewer. No new app permissions or repository enrollment are granted by orchestration. Impact is dispatched to its existing impact-specific implementation, while the other five roles use the shared advisory engine. Neither path can approve or authorize a merge.

## Separate GitHub identities

Register each `oddmash-<role>` GitHub App under Oddmash and install it only in authorized repositories. Subscribe only to issue comment events. Use Contents read, Checks read and Issues write repository permissions. PR-scoped advisory roles require Pull requests write for PR comment publication; Triage retains Pull requests read. No Contents write or Checks write. Advisory agents do not submit formal reviews or authorize merges. Restrict permissions to the existing approved repository identities. The app webhook URL is the existing production origin plus `/api/advisory?agent=<role>`.

Configure `<ROLE>_APP_ID`, `<ROLE>_APP_PRIVATE_KEY`, `<ROLE>_WEBHOOK_SECRET`, and `<ROLE>_APP_ENABLED=true` in the existing protected production environment. Use a distinct App ID and independently generated secrets per role. Usage is logged by role. Optionally configure `<ROLE>_OPENAI_API_KEY` and `<ROLE>_OPENAI_MODEL` for individual OpenAI project billing and model selection; absent role-specific settings, usage is attributed by role in logs but billed to the shared project. Reviewer retains its existing model configuration. The service rejects missing or duplicate app identities and verifies the dedicated signature before routing; dedicated queue jobs retain the authenticated role and cannot enter review/merge paths. Start each app disabled until its installation, webhook and handling of an explicit command have been verified. Never paste keys in comments, issues, or documentation.

## Avatar system

The files in `assets/agents/` are independent robot badges, not the organization logo. A consistent dark face and role-specific symbol distinguish agents at small sizes. Export the SVG to square PNG for an app profile image if required.

| Role | Symbol | Accent |
| --- | --- | --- |
| Reviewer | Eye | Sky |
| Impact | Spark | Apricot |
| Triage | Ordered list | Lavender |
| QA | Checkmark | Mint |
| Release | Rocket | Gold |
| Docs | Book | Teal |
| Architect | Structure | Periwinkle |

Keep the badge and symbol recognizable without relying only on color. The original Oddmash brand remains reserved for organization and product identity.
