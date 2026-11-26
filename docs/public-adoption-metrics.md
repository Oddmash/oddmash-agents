# Public adoption metrics

The allowlist uses the published package manifests for @oddmash/ui, @oddmash/juliya and boundra plus the Boundra editor manifest and README Marketplace listing oddmash.boundra-vscode.

The daily Public Adoption Metrics workflow uses only public endpoints. It requests each npm package's provider-reported daily download series for the last month, and the exact Marketplace extension's reported install statistic. Counts are not unique users or active installations. Provider data may be delayed, inconsistent or unavailable. Missing or invalid numbers are represented as null, not zero; Marketplace history is not fabricated from one count.

Snapshot artifacts contain only aggregate counts, source links and observation timestamps and expire after 30 days. The schedule runs at 03:23 UTC; manual dispatch is limited to the existing main workflow. No extra token, telemetry, user identifiers, private traffic, repository write permission, or provider billing access is needed. The console's Model usage page includes Public product adoption. The owner-only GET /api/adoption route fetches the four sources with a six-second timeout and per-instance in-flight deduplication; successful or partial observations are cached for one hour, all-unavailable results for one minute. It never accesses private storage. npm daily series is visible directly; historical Marketplace observations are linked through the scheduled workflow's retained snapshots, not fabricated into a continuous series.

Search Console aggregate data is intentionally separate; enabling it would require an explicit data access decision.
