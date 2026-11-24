# Oddmash agent family

One repository, Vercel project and queue serve the agents. Each role has individual usage attribution and optionally independent model configuration. Lead retains its existing automatic review policy. Other agents primarily respond to explicit maintainer commands and publish advice, not approval or operational actions. When `REVIEWER_AUTO_ADVISORY_ENABLED=true`, Lead selects relevant PR advisors after a regular review or a full `/review` requested in PR conversation, within the configured request and elapsed-time budgets; Triage remains issue-only. A small documentation-only edit needs no automatic advisor, a UI feature can select Impact and QA, an API change can also select Docs, and structural or release changes can select Architect or Release. The deterministic priority order resolves a limited budget without recursively invoking agents. See [agent operations](agent-operations.md) for limits.

| Role | Target | Command | Output |
| --- | --- | --- | --- |
| Lead | PR | `/review` | Coordinate specialists, validate concrete defects and issue formal review |
| Impact | PR | `/impact` | Value, product fit, cost and trade-offs |
| Triage | Issue | `/triage` | Classification, priority, related issues and next steps |
| QA | PR | `/qa` | Observed CI, test coverage and missing scenarios |
| Release | PR | `/release` | Release note draft and version impact |
| Docs | PR | `/docs` | Documentation changes and examples |
| Architect | PR | `/architect` | Design, trade-offs and maintainability |

For explicit manual requests until independent apps are configured, invoke each advisory role with `@oddmash-lead[bot] /<role>`. Once configured, use `@oddmash-<role>[bot] /<role>`. Do not invoke both for the same assessment. Each role uses one updatable bilingual advisory for its own authenticated identity and evidence snapshot. It does not alter labels, issue state, checks, release or merge decisions.

For coordinated requests, Lead resolves the selected role's own enabled App installation for the repository and uses that role's existing scoped token. Unavailable, unconfigured or unauthorized roles are skipped, with no fallback publication under Lead. No new app permissions or repository enrollment are granted by orchestration. Impact is dispatched to its existing impact-specific implementation, while the other five roles use the shared advisory engine. Neither path can approve or authorize a merge.


The roles use [bundled shared skill guidance](skill-integration.md) and applicable project `AGENTS.md` from a trusted revision. Role prompts and repository policy define what each agent can report and which actions the service may take.

## Slash commands

Maintainers can enter one command on the first non-empty line of an issue or PR comment. Put optional context on subsequent lines. Quoted or embedded commands and comments containing multiple commands are ignored. The total comment limit is 2,000 characters.

| Context | Commands |
| --- | --- |
| Open PR conversation | `/review`, `/qa`, `/docs`, `/impact`, `/architect`, `/release` |
| Reply in an open PR inline thread | `/review` |
| Open issue | `/triage` |

Lead receives the slash command. Advisory responses use the corresponding dedicated, enabled GitHub App installed on that repository. Explicit App mention commands still work. GitHub does not provide native autocomplete for these commands. For a review request awaiting required CI, the same comment is reused when review resumes.

The release workflow syncs the GitHub Actions repository variable `REVIEWER_AUTO_ADVISORY_ENABLED` to Vercel Production when it is set to `true` or `false`. Leaving the Actions variable unset preserves the current Vercel setting. The setting takes effect with the next production release.

## Lead identity

Lead is the renamed primary review App. Its verified authenticated account is `oddmash-lead[bot]`. Use the [identity guide](lead-identity.md) for attribution. The App ID, webhook endpoint, existing environment key names and historical attribution remain unchanged.

## Release preparation

For a new production release, run the [release preparation workflow](release-preparation.md). It uses Release for the exact candidate and conditionally QA, separately from individual PR advisory requests.

## Separate GitHub identities

Register each `oddmash-<role>` GitHub App under Oddmash and install it only in authorized repositories. Subscribe all specialist apps to issue comment events. For PR-scoped roles, also subscribe to pull request review comment events. Use Contents read, Checks read and Issues write repository permissions. PR-scoped advisory roles require Pull requests write for PR comment publication; Triage retains Pull requests read. No Contents write or Checks write. Advisory agents do not submit formal reviews or authorize merges. Restrict permissions to the existing approved repository identities. The app webhook URL is the existing production origin plus `/api/advisory?agent=<role>`.

Configure `<ROLE>_APP_ID`, `<ROLE>_APP_PRIVATE_KEY`, `<ROLE>_WEBHOOK_SECRET`, and `<ROLE>_APP_ENABLED=true` in the existing protected production environment. Use a distinct App ID and independently generated secrets per role. Usage is logged by role. Optionally configure `<ROLE>_OPENAI_API_KEY` and `<ROLE>_OPENAI_MODEL` for individual OpenAI project billing and model selection; absent role-specific settings, usage is attributed by role in logs but billed to the shared project. Lead retains its existing model configuration. The service rejects missing or duplicate app identities and verifies the dedicated signature before routing; dedicated queue jobs retain the authenticated role and cannot enter review/merge paths. Start each app disabled until its installation, webhook and handling of an explicit command have been verified. Never paste keys in comments, issues, or documentation.

Dedicated PR specialists can publish up to three verified findings on added lines. Lead collects one follow-up from each coordinated specialist in its review. An explicitly requested specialist can keep a separate, updated Conversation summary. A matching finding on the same revision and line stays in its original thread. To ask about a finding, reply in its thread and mention the specialist account that opened it, such as `@oddmash-qa[bot]`. The specialist handles only maintainer replies to its own findings and leaves formal review decisions to Lead. Triage remains issue-only.

## Avatar system

The files in `assets/agents/` are independent robot badges, not the organization logo. A consistent dark face and role-specific symbol distinguish agents at small sizes. Export the SVG to square PNG for an app profile image if required.

| Role | Symbol | Accent |
| --- | --- | --- |
| Lead | Compass | Sky |
| Impact | Spark | Apricot |
| Triage | Ordered list | Lavender |
| QA | Checkmark | Mint |
| Release | Rocket | Gold |
| Docs | Book | Teal |
| Architect | Structure | Periwinkle |

Keep the badge and symbol recognizable without relying only on color. The original Oddmash brand remains reserved for organization and product identity.
