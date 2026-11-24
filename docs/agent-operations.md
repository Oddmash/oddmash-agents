# Agent operations

Keep all roles on the existing serverless application. The role-specific request and result contracts remain independent; the shared model helper only bounds serialized requests and records usage.

## Execution history

Filter the project runtime logs by `oddmash_agent_execution`. Each event contains role, a correlation identifier derived from the validated delivery UUID (or a random identifier if unavailable), attempt, retry count, timestamp and outcome. Returned and failed events include duration; a failed event includes only a fixed failure category. Neither source, prompts, response bodies, error messages, credentials nor repository names are logged by this helper.

Queue acceptance records `queued` after successful publication. Direct and queue execution record `started` and `returned` or `failed`. The same validated delivery and role retain the same correlation across retry attempts. Returned means the handler returned normally, which includes existing deduplication and ineligible/stale work; it is not proof a review or comment was published. Coordinated advisory roles have independent execution identifiers. Existing exact-head, deduplication and retry rules still apply.

For an operational snapshot, count terminal returned and failed events by role and distinct correlation plus attempt. Count retries separately; do not divide failed attempts by all queued events or claim a durable task history. Access is restricted to authorized project operators and retention is the hosting plan's runtime log retention. No extra database, log drain or dashboard is provisioned.

## Model limits

Every model operation has a fixed output cap and a maximum UTF-8 serialized request size, including instructions and evidence. Role-specific environment variables can tighten, never increase, these hard defaults. Values are positive integers; invalid settings fall back to the defaults. Output cap values below 16 are invalid.

| Phase or role | Request bytes | Output tokens |
| --- | ---: | ---: |
| Review | 512000 | 6000 |
| Blocker confirmation | 512000 | 1000 |
| Reviewer discussion | 128000 | 1000 |
| Impact | 192000 | 1400 |
| Triage, QA, Release, Docs, Architect | 192000 | 1100 |

For example, `QA_MAX_INPUT_BYTES=96000` and `QA_MAX_OUTPUT_TOKENS=800` tighten QA alone. Use `REVIEWER_MAX_INPUT_BYTES` and `REVIEWER_MAX_OUTPUT_TOKENS` for all Reviewer phases. Over-budget input stops before transmission with a fixed diagnostic; the queue treats that failure as permanent. An incomplete model result cannot constitute approval. The helper does not add retries or expand evidence scope.

Each phase makes one model request. A review can make an independent blocker-confirmation request; coordinated advisory mode can add at most two requests. The existing bounded queue attempts and deduplication constrain replay, but a failed delivery after a paid request can repeat work. This is not a guaranteed at-most-once billing system. Do not enable coordinated advisory solely to collect usage.

## Cost monitoring

Filter runtime logs by `reviewer_usage`, group by role, phase and model, and sum observed input/output token counts. Missing or invalid counts are null and must not be treated as zero. Multiply observed token categories by the applicable model rates for an estimate; actual billed cost can differ due to cached input, reasoning, provider adjustments and failed or unobserved calls. Compare against provider billing exports for the authoritative amount.

Without role-specific OpenAI project keys, role attribution is logical and charges appear in the shared project. Separate per-role keys may support project-level billing; no new keys, budget settings or paid services are created here. Avoid daily/monthly hard-cap claims until durable accounting and enforcement are justified.
