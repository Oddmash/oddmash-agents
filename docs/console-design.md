# Operator console design

Primary task: identify active or failed work, open its target and inspect retained evidence. The console is not a generic analytics landing. Overview prioritizes operational attention with four actionable metrics and compact recent target rows; selecting a target opens its exact history workflow with an explicit action to return to all targets in that repository. History preserves repository and target filters; Contributor PRs excludes internal contributions; Usage and Settings retain separate responsibilities.

Replace the fixed graph canvas with responsive observed-role cards and accessible execution detail timelines. A static topology canvas was rejected because fixed scaling reduced control and type legibility, required unnecessary zoom/pan controls, and emphasized unobserved roles. Sort failures and active work first; group unobserved roles in a disclosure. Publication is separate from execution and approval. Do not infer a single chronological sequence, an overall progress percentage or unsupported CI status.

Use released Oddmash UI, shared semantic tokens and local geometry tokens. Keep icon sizes consistent, labels readable and rows aligned without shrinking controls. Support Korean/English and light/dark. Running emphasis is limited to observed running state and respects reduced motion.

Public product adoption shows the last seven or thirty reported UTC calendar days as bars, with an observed total, exact daily values, explicit zero and unknown states, and the provider-reported month aggregate. Marketplace installs remain an independent cumulative metric. The chart fits narrow screens without page overflow.

## Operator data and layout

Use compact attention metrics, target rows and contributor summaries. Show workflow state in the list and let operators expand reviews, failed jobs and retained execution evidence on demand. Group theme and language under Preferences to leave more room for the active view.

Keep contributor and telemetry snapshots in the current authenticated console instance. Reuse them on short route changes, retain them during refresh, and surface a retry when a refresh fails. Report partial results separately from an observed empty list. A denied read clears console content. Browser and HTTP caches remain disabled for authenticated responses.

## Acceptance evidence

Before merging a substantial presentation change, record separate functional CI and rendered design acceptance at the exact revision. Use representative synthetic or authorized observed states: failed, running, returned, no observations, long titles and labels. Inspect desktop, 390px and 320px, both themes and locales, keyboard focus and dialog closure, reduced motion, and horizontal overflow. Report observed results and unverified checks separately; do not publish private data in screenshots. Do not treat green CI as design acceptance. Revisit the layout if the primary task remains hard to complete.
