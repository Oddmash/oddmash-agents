# Console fixtures

Check out `test/console-fixtures`, run `corepack pnpm install --frozen-lockfile` at the repository root, then run `node apps/console/fixtures/server.mjs`. Open http://127.0.0.1:4175/en or http://127.0.0.1:4175/ko.

The real console runs against local, synthetic API responses. Runtime controls and agent model settings can be saved in memory, with revision checks. A restart discards all edits. Ports 4175 and 4312 must be free. No environment variables, credentials or external requests are required. Keep this branch separate from production changes. Bring candidate branches into it for local QA.

The default scenario includes running, failed, returned and missing evidence. Change a single API resource before navigating or refreshing.

```sh
curl -X POST 'http://127.0.0.1:4312/__fixture?resource=/api/contributors&scenario=slow'
curl 'http://127.0.0.1:4312/__fixture'
```

Set `populated` to reset the resource. Other scenarios are `empty`, `partial`, `unavailable` and `expired`. Empty fixtures are supported for status, contributors and adoption. Partial applies to contributors. Restart the process to reset all scenarios and request counts.

With the server running, run `node apps/console/fixtures/verify.mjs /path/to/evidence` from the root. The verifier requires an installed Playwright Chromium. Set `CONSOLE_PLAYWRIGHT_MODULE` to the absolute path of Playwright's `index.mjs` when installed outside this worktree. It runs the responsive and state matrix and writes synthetic screenshots to the output directory.
