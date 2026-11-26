# Oddmash Agents Console

Vite + React frontend and a route-scoped Hono HTTP API in the same workspace. Deploy the existing single Vercel project from the repository root. The root configuration builds the console into apps/console/dist and serves only those static assets; existing worker API and queue routes remain unchanged.

Set AUTH_URL to the exact console origin plus /api/auth, register the GitHub OAuth callback at /api/auth/callback/github, and configure AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and CONSOLE_OWNER_GITHUB_ID (the verified numeric owner ID). Only the authorized account can read operator status. No provider is provisioned or enabled by this code. Worker and console use a shared OPERATOR_STORE_URL with separate write and read-only tokens; never put worker credentials or any secret in VITE_ variables.

Run pnpm --filter @oddmash/agents-console dev:api in one terminal and pnpm --filter @oddmash/agents-console dev in another. The development frontend proxies /api to the local Hono server. Root functions expose /api/status, /api/availability and /api/auth/* on the same origin as the Vite assets. No catch-all route intercepts worker endpoints. The console status API remains owner-only even though the sign-in shell is public. If storage is unconfigured, the UI displays that condition instead of simulated data.

Runtime controls can pause new Lead and Triage jobs independently. Scoped replies and running jobs continue. The coordinated-specialist toggle and request limits apply to optional specialists. Changes take effect after saving. If a configured controls store cannot be read, new Lead and Triage jobs wait for confirmation; queued jobs follow the existing retry policy.

History is limited to 500 events within seven days. The worker retains GitHub Checks and runtime logs if optional telemetry fails. Status polls every ten seconds during active work and backs off to thirty seconds while idle; hidden tabs stop polling.

Production activation requires verifying authorization, the actual Vercel routing, non-owner rejection, and real telemetry before enabling the store. Both worker and console are promoted together only after staged checks pass.
