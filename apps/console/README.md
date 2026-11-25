# Oddmash Agents Console

Vite + React frontend and a separate Hono HTTP API in the same workspace. Deploy this app as a distinct Vercel project rooted at apps/console; the worker remains deployed from the repository root.

Set AUTH_URL to the exact console origin plus /api/auth, register the GitHub OAuth callback at /api/auth/callback/github, and configure AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and CONSOLE_OWNER_GITHUB_ID (the verified numeric owner ID). Only the authorized account can read operator status. No provider is provisioned or enabled by this code. Worker and console use a shared OPERATOR_STORE_URL with separate write and read-only tokens; never put worker credentials or any secret in VITE_ variables.

Run pnpm --filter @oddmash/agents-console dev:api in one terminal and pnpm --filter @oddmash/agents-console dev in another. The development frontend proxies /api to the local Hono server. The Vercel catch-all function serves auth and status routes on the same origin as the Vite assets. If storage is unconfigured, the UI displays that condition instead of simulated data.

History is limited to 500 events within seven days. The worker retains GitHub Checks and runtime logs if optional telemetry fails. Status polls every ten seconds during active work and backs off to thirty seconds while idle; hidden tabs stop polling.

Production activation requires verifying authorization, the actual Vercel routing, non-owner rejection, and real telemetry before enabling the store.
