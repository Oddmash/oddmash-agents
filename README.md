# Oddmash Agents

Advisory agents for Oddmash products. The first agent, Reviewer, helps maintainers identify concrete regressions in pull requests while preserving project-specific conventions and maintainer control.

## Reviewer

- Analyzes public, explicitly opted-in open PRs using GitHub's changed-file and check APIs.
- Uses organization and trusted base-branch root and nested `AGENTS.md` guidance.
- Produces English, evidence-linked, severity-ranked reports and optional inline GitHub Suggested changes; posting is explicitly enabled and deduplicated per finding and commit.
- Never checks out or executes contributor code, approves, merges, deploys or modifies source.

This is a report-only pilot by default. No GitHub App or production integration has been activated.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and [the rollout plan](docs/rollout.md) for the activation checklist.
