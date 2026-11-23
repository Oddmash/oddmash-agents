# Evaluation baseline: 2026-11-23

Six public PRs were sampled from recent Oddmash activity. Review submissions and inline discussions were read; two disputed findings were independently checked against the source at the reviewed commit. These are observations, not a complete precision/recall benchmark.

| PR | Observed review | Ground truth |
| --- | --- | --- |
| [oddmash-ui#30](https://github.com/Oddmash/oddmash-ui/pull/30) | Advisory about disabled pointer activation | Dismissed: the shared selection function guards disabled items before side effects. Verified against the reviewed head. |
| [interaction-inspector#14](https://github.com/Oddmash/interaction-inspector/pull/14) | Blocking warning about raw ARIA export, then approval | Dismissed: the export uses a token allowlist and normalization helper. Verified against the reviewed head. |
| [kowrap#29](https://github.com/Oddmash/kowrap/pull/29) | Approved | Not independently adjudicated. |
| [kowrap#27](https://github.com/Oddmash/kowrap/pull/27) | Changes requested | Not independently adjudicated. |
| [Vertactics#103](https://github.com/Oddmash/Vertactics/pull/103) | Approved | Not independently adjudicated. |
| [oddmash-ui#25](https://github.com/Oddmash/oddmash-ui/pull/25) | Human approval | Not an agent evaluation. |

The two verified dismissals show the same failure mode: identifying a potential problem at a call site without tracing existing mitigation. The reviewer now receives bounded same-file head context and explicit reviewed feedback about tracing helpers; the separate blocker confirmation receives identical context. These rules do not suppress real defects. Synthetic regression fixtures verify context delivery; live model quality has not yet been re-measured. Record further findings with exact commit, anchor, human disposition, and rationale, including defects missed by the bot; do not infer correctness from approval or thread resolution alone.
