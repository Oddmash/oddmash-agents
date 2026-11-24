# Shared skill integration

The organization [working agreements](https://github.com/Oddmash/.github/blob/main/AGENTS.md) and [AI review policy](https://github.com/Oddmash/.github/blob/main/docs/AI-CODE-REVIEW.md) define the operational boundaries. The [skills catalog](https://github.com/Oddmash/oddmash-skills) defines reusable methods. Product repositories define their own contracts and verification commands.

## Approved reference baseline

| Consumer | Skill | Revision | Usage |
| --- | --- | --- | --- |
| Reviewer maintenance | [oddmash-quality-assurance](https://github.com/Oddmash/oddmash-skills/blob/5bc1c57882af6f189251277c26418c0febbadd46/skills/oddmash-quality-assurance/SKILL.md) | `5bc1c57882af6f189251277c26418c0febbadd46` | Maintainer test planning and evidence assessment |

The reference is for maintainers developing and verifying the reviewer. It is not loaded into deployed review prompts and does not change current runtime behavior. Additional consumers must define their own reviewed references before adoption.

## Upgrade procedure

1. Review changes to the exact skill path and any required references against the current pinned revision.
2. Update the reference in this document through a ready-for-review pull request by default, reserving drafts for documented organization exceptions. Record the reason, affected consumers, compatibility, and verification evidence.
3. Run the relevant deterministic tests and review the affected behavior before merging.
4. If an agent needs runtime consumption in the future, implement and review it separately with a trusted, immutable, locally available artifact and explicit data-handling boundaries. Do not fetch mutable instructions during a review.
5. Roll back by reverting the reference change and, if applicable, the independently reviewed deployment.

## Authority and failure handling

Skills never grant invocation, repository access, posting, merging, or deployment rights. Keep credentials and private source out of shared guidance and review output. If an approved reference is unavailable, report the missing guidance rather than substituting an unreviewed version. Existing reviewer policy, repository authorization, and deployment controls remain unchanged.

## Recurring quality feedback

Use the catalog's [skill improvement proposal workflow](https://github.com/Oddmash/oddmash-skills/blob/main/docs/skill-improvement-proposals.md) for recurring confirmed non-security feedback across separate product PRs. This is a maintainer-reviewed improvement queue, not a change to review, advisory or deployment behavior. Agent comments can supply evidence, but they do not authorize publication or mutate guidance.

Run the proposal helper from this repository using the maintainer's existing authenticated GitHub CLI session. Categorize two to eight distinct public merged PRs, read their review discussions, confirm the same actionable quality problem and inspect the currently owning skill for a genuine shared gap. For example, use the following format with real, verified PR numbers:

```sh
pnpm skills:proposal ui-feedback Oddmash/kowrap#123 Oddmash/oddmash-ui#456
````

The command previews the issue or novel evidence comment without writing. After independently verifying the evidence and the proposed gap, rerun the same command with `--confirm-gap --publish` only if authorized to post. The fixed categories are `ui-feedback`, `visual-layout`, `docs-examples`, `test-coverage`, `compatibility`, and `maintainability`. Do not infer that a merged PR validates a particular finding; a maintainer confirms that from the source discussion.

The helper verifies active public product repositories and merged PR identity, rejects private and unsupported references, and uses only fixed text plus public PR permalinks. It identifies the catalog issue by stable skill/category marker, adds only new references, and does not reopen closed issues or publish if history is ambiguous or incomplete. Serialize publication by category and inspect the catalog issue list if a request fails; GitHub issue creation is not atomic with lookup. Do not grant deployed GitHub Apps additional cross-repository access to run this helper.
