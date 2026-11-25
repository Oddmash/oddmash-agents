# Oddmash Agents Console

Private operator UI. This app requires a separate Vercel project rooted at apps/console, with the workspace lockfile and worker still deployed from the repository root. Configure a GitHub OAuth application callback at the exact console origin plus /api/auth/callback/github, and set AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and CONSOLE_OWNER_GITHUB_ID (the verified numeric owner ID). No account may access private status before server authentication. The worker uses OPERATOR_STORE_URL and OPERATOR_STORE_WRITE_TOKEN; the console uses the same URL and a distinct read-only OPERATOR_STORE_READ_TOKEN. Never use the worker's credentials in the console.
 
No provider is created or enabled by this code. If storage is unconfigured the UI displays that condition, not mock data. Events are limited to 500 and read within seven days; a returned handler is not an approval. Status reads poll every ten seconds during active work and back off to thirty seconds when idle, stopping when hidden. The worker retains existing GitHub Checks and runtime logs if telemetry fails. No model requests are made for status.

Run pnpm --filter @oddmash/agents-console dev, typecheck and build after a frozen workspace install. Production deployment must verify login rejection for non-owners, status API denial without a session and actual worker events before enabling the store.
