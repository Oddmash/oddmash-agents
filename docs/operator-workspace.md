# Operator workspace

The existing root worker remains the production Vercel entrypoint until a separately reviewed migration proves identical webhook, queue, and release behavior. The pnpm workspace already supports independent applications and shared packages. From the root, run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test` and `pnpm run typecheck`. Run the console with `pnpm --filter @oddmash/agents-console dev`; verify its build with `pnpm --filter @oddmash/agents-console build`. Internal packages use workspace dependencies and explicit exports.

| Layer | Responsibility |
| --- | --- |
| Root Hono worker (future apps/worker) | GitHub webhook, queue, agent execution, release and policy enforcement |
| packages/operator-contract | Sanitized execution events, state projection, safe configuration contract |
| apps/console (next phase) | Private authenticated read-only operator UI and server-side data access |

## Execution data

The worker emits its existing role-correlated lifecycle events. Events now optionally include the verified public repository and issue/PR number, and actual review phases when the corresponding work is reached. Private repository names and numbers are omitted. A returned handler is not evidence of an approved or completed review. Projected jobs show returned, failed, queued, running or stale; stale is a UI inference based on elapsed time, not an agent verdict. New attempts replace older state. Unknown fields and invalid identifiers are discarded; no model text, credential, request body or source code is part of the contract.

## Configuration

The worker exposes an internal projection function that selects explicit non-secret model and feature settings and whether required configuration is present. Configured is not proof that credentials work. No public route exposes the projection. The console must obtain it via a separately authenticated server-side channel or a bounded sanitized snapshot in shared storage.

## Next phases

1. Adopt #178 rate-limit diagnostics and #180 API efficiency improvements without widening token permissions.
2. Implement a separate Vite + React console application with a separate Hono HTTP API in this repository with GitHub account authentication. Enforce verified maintainer ID and no-store on all private pages and status endpoints; do not ship the worker's tokens to the browser. A distinct Vercel deployment isolates failures and configuration. Provision a bounded event store with write-only worker and read-only console access after explicit setup, or use an authorized read-only log source. Start with 7-day history and 5-10 second visible-active polling; stop on hidden tabs and terminal work, back off on errors.
3. Move worker entrypoints only after testing existing webhook URLs, queue triggers, build roots, release gating and rollback. Keep the existing required verify check and include all workspace package and console tests before production activation.

Related: #169, #178, #180, #181.
