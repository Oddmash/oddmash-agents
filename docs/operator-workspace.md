# Operator workspace

The existing root worker remains the production Vercel entrypoint until a separately reviewed migration proves identical webhook, queue, and release behavior. The pnpm workspace already supports independent applications and shared packages. From the root, run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test` and `pnpm run typecheck`. Run the local API with `pnpm --filter @oddmash/agents-console dev:api` and the console with `pnpm --filter @oddmash/agents-console dev` in separate terminals; verify its build with `pnpm --filter @oddmash/agents-console build`. Internal packages use workspace dependencies and explicit exports. They are private, source-only TypeScript contracts for the supported Node.js 24 worker and TypeScript-aware Vite build; they are not JavaScript library releases or supported external package APIs.

| Layer | Responsibility |
| --- | --- |
| Root Hono worker (future apps/worker) | GitHub webhook, queue, agent execution, release and policy enforcement |
| packages/operator-contract | Sanitized execution events, state projection, safe configuration contract |
| packages/operator-store | Bounded optional telemetry persistence and read-only status projection |
| apps/console | Private authenticated read-only operator UI and server-side data access |

## Execution data

The worker emits its existing role-correlated lifecycle events. Events now optionally include the verified public repository and issue/PR number, and actual review phases when the corresponding work is reached. Private repository names and numbers are omitted. A returned handler is not evidence of an approved or completed review. Projected jobs show returned, failed, queued, running or stale; stale is a UI inference based on elapsed time, not an agent verdict. New attempts replace older state. Unknown fields and invalid identifiers are discarded; no model text, credential, request body or source code is part of the contract.

## Configuration

The worker exposes an internal projection function that selects explicit non-secret model and feature settings and whether required configuration is present. Configured is not proof that credentials work. No public route exposes the projection. The console uses the Hono status API and optional bounded shared storage; it does not read worker environment variables or credentials directly. See the [console setup guide](../apps/console/README.md) for required GitHub OAuth and owner authentication variables, callback configuration, and optional worker/console storage credentials. Without storage, the console shows that telemetry is unconfigured.

## Next phases

1. Adopt #178 rate-limit diagnostics and #180 API efficiency improvements without widening token permissions.
2. Activate the implemented Vite + React console with its Hono HTTP API after explicit deployment and GitHub OAuth configuration. Enforce verified maintainer ID and no-store on status endpoints; do not ship worker tokens to the browser. Deploy independently from the worker and configure a bounded event store with separate worker write-capable and console read-only tokens. The console reads at most 500 events within seven days and polls every ten seconds during active work, thirty seconds while idle, and stops while hidden. Verify actual production routing, owner-only auth and telemetry before enabling the store.
3. Move worker entrypoints only after testing existing webhook URLs, queue triggers, build roots, release gating and rollback. Keep the existing required verify check and include all workspace package and console tests before production activation.

Related: #169, #178, #180, #181.
