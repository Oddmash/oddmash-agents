# Release preparation advisories

Use this procedure before publishing a new stable GitHub Release. It complements [the production release process](release-process.md); it does not replace review, CI, or deployment authorization.

1. Merge reviewed changes into `main`, wait for its CI to succeed, and record the full main commit SHA and latest published stable tag.
2. In Actions, select **Prepare release**, choose the `main` branch and enter the previous tag and exact candidate SHA.
3. Read the workflow summary. For a code, dependency, configuration, workflow, or uncertain change scope, QA produces a provisional range-level verification assessment first. For known documentation/test-only changes, QA is skipped. Release always produces a draft for a new candidate and considers any QA advice.
4. Verify the suggested version, release note wording, actual merged PR references, compatibility, migration requirements and any remaining verification. Apply the documented release note format. Do not treat the advisory as evidence that tests were executed.
5. If main or the previous release changes, prepare again before publishing. A successful preparation for the same candidate and previous tag is reusable; the workflow rechecks current main and CI and links the previous run without calling either model again. Failed or incomplete preparations are not cached as successful. Published tags must not be moved.

The workflow is an explicit maintainer operation on the reviewed default branch, not a PR or release-event trigger. It uses the existing role-specific model settings when available, otherwise the shared model configuration. It makes at most one request per role per run and sends only bounded, filtered commit subjects, aggregate scope metadata, observed CI status and provisional QA output. No source patches, protected filenames, credentials, or production configuration are sent. Compare evidence is bounded, and coverage limitations require manual confirmation. It publishes an Actions summary, not a GitHub App impersonation or formal review.

Release draft preparation is advisory. An unavailable advisor is reported; the maintainer can inspect evidence manually rather than turn AI availability into a deployment gate. Existing production deployment still validates the authorized published stable release and runs exact-commit CI, build, smoke tests and promotion checks. No new deploy or repository write privileges are granted.
