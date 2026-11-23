# Rollout

1. Create the private `Oddmash/oddmash-agents` repository. Keep reusable concepts and product skills in `oddmash-skills`, not in the runtime.
2. Run offline tests and check the GitHub API and model integration against one public Oddmash UI PR in report-only mode. Compare findings with maintainer review; track accepted findings, dismissed findings, latency, cost and coverage omissions.
3. After explicit approval, register a dedicated GitHub App for selected public repositories only. Permissions: metadata read, contents read, checks read, pull requests read/write for advisory comments. No administration, actions write, secrets, deployment or branch write permission. Keep installation credentials outside the repo.
4. Integrate trusted, pinned execution with a per-PR concurrency group. For automation, trigger on PR changes and check completion without ever executing the PR's code in a privileged context. Check head SHA again before posting; add cross-run finding-level deduplication and stale-comment handling before expanding the pilot.
5. Add Maintainer, Design Auditor and Release Manager as separate advisory modules only after reviewer precision and cost are documented. Developer automation is a separate approval-gated project.

Current limits: CLI only, no webhook/App installation, no live API test, first 100 files with strict review budgets, base guidance capped at 24,000 characters, no skill-reference traversal yet, and one summary comment per head SHA. Manual review remains required.
