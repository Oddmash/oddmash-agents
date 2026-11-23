# Shared skill integration

The organization [working agreements](https://github.com/Oddmash/.github/blob/main/AGENTS.md) and [AI review policy](https://github.com/Oddmash/.github/blob/main/docs/AI-CODE-REVIEW.md) define the operational boundaries. The [skills catalog](https://github.com/Oddmash/oddmash-skills) defines reusable methods. Product repositories define their own contracts and verification commands.

## Approved reference baseline

| Consumer | Skill | Revision | Usage |
| --- | --- | --- | --- |
| Reviewer maintenance | [oddmash-quality-assurance](https://github.com/Oddmash/oddmash-skills/blob/5bc1c57882af6f189251277c26418c0febbadd46/skills/oddmash-quality-assurance/SKILL.md) | `5bc1c57882af6f189251277c26418c0febbadd46` | Maintainer test planning and evidence assessment |

The reference is for maintainers developing and verifying the reviewer. It is not loaded into deployed review prompts and does not change current runtime behavior. Additional consumers must define their own reviewed references before adoption.

## Upgrade procedure

1. Review changes to the exact skill path and any required references against the current pinned revision.
2. Update the reference in this document through a pull request. Record the reason, affected consumers, compatibility, and verification evidence.
3. Run the relevant deterministic tests and review the affected behavior before merging.
4. If an agent needs runtime consumption in the future, implement and review it separately with a trusted, immutable, locally available artifact and explicit data-handling boundaries. Do not fetch mutable instructions during a review.
5. Roll back by reverting the reference change and, if applicable, the independently reviewed deployment.

## Authority and failure handling

Skills never grant invocation, repository access, posting, merging, or deployment rights. Keep credentials and private source out of shared guidance and review output. If an approved reference is unavailable, report the missing guidance rather than substituting an unreviewed version. Existing reviewer policy, repository authorization, and deployment controls remain unchanged.
