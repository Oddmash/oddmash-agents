# Reviewer quality and operations

The reviewer uses a bounded, project-specific focus and may read direct relative imports from the immutable public base commit and complete small changed source files from the reviewed head. Related files are context, not independent finding anchors. Private reviews retain their original changed-patch boundary. Deleted-line findings use LEFT anchors and remain advisory; they cannot carry suggestions or blocking evidence.

Maintainer comment requests that arrive before passing checks persist a bot-authored acknowledgement tied to the exact head. A check-suite completion can resume the request without a second mention. Stale heads and already-recorded requests are ignored. The scan is bounded to 100 comments per type; if exceeded, use the explicit manual command. A failed check requires repair and a passing check event. Native GitHub review requests without a comment still require manual retry if checks are not ready.

Usage events record only model, phase and numeric input/output/total tokens. Aggregate them by phase and model using the applicable pricing; do not log prompts or source. Missing usage is not recorded as zero cost.

## Evaluation

Maintain a reviewed corpus of synthetic or expressly approved public patches. Include no-defect changes, deleted behavior, incorrect loading states, accessibility regressions, SSR mismatches, intentional alternative implementations, and ordinary correctness regressions. Label expected finding anchors and separately adjudicate whether each finding is genuinely actionable. The anchor evaluator counts true positives, false positives and false negatives without counting duplicate anchors. Anchor matches alone do not prove semantic correctness; evaluate severity, evidence and false blocking manually. Compare model versions on the same corpus before enabling policy changes.

Record maintainer corrections as explicit, reviewed test fixtures or version-controlled product guidance, not as automatically trusted instructions. The bot's discussion verdict does not authorize a review decision. Add cases only after adjudication. See [the first public PR baseline](evaluation-baseline.md) and the reviewed feedback rules in `src/review-feedback.ts`.

## Remaining production rollout

The optional Vercel Queue worker accepts only signed deliveries and persists a bounded target, delivery ID and signature, never credentials or patches. After a reviewed deployment registers the queue trigger, set the repository Actions variable `REVIEWER_QUEUE_ENABLED=true` and redeploy; the default is false. Publish before returning 202. Duplicate delivery IDs are deduplicated; the worker revalidates repository scope and skips stale known heads. Transient failures retry with bounded backoff; quota and permanent failures go to a separate failure topic for maintainer inspection. Failure records expire after 24 hours. Manual recovery requires a new signed GitHub delivery or an explicit maintainer review request. No scheduled reconciliation is enabled. Verify real webhook deliveries, queue consumption, failure handling, comment permissions, LEFT inline comments and deployment logs before rollout.

The isolated auto-merge module attempts a normal merge immediately after eligible approval, before cosmetic label updates. An acceptance proof is bound to the exact repository, PR, head, base, merge commit and linked issue revision. A redelivery may retry the merge without another model review only if that proof still matches and all current policy gates pass. Approvals predating this proof require a fresh explicit review. Policy exclusions remain unchanged.

When an approved PR cannot be automatically merged, the app posts or refreshes a single bilingual automation-status comment with a safe, actionable reason for the current head. Review request failures use a separate status comment. Repeated identical reasons do not create new comments; after successful processing an existing status is marked completed. Raw exception text, source and credentials are never posted.
