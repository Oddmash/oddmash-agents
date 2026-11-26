# Public adoption metrics

The allowlist uses the published package manifests for @oddmash/ui, @oddmash/juliya and boundra plus the Boundra editor manifest and README Marketplace listing oddmash.boundra-vscode.

The daily Public Adoption Metrics workflow uses only public endpoints. It requests each npm package's provider-reported daily download series for the last month, and the exact Marketplace extension's reported install statistic. Counts are not unique users or active installations. Provider data may be delayed, inconsistent or unavailable. Missing or invalid numbers are represented as null, not zero; Marketplace history is not fabricated from one count.

Snapshot artifacts contain only aggregate counts, source links and observation timestamps and expire after 30 days. The schedule runs at 03:23 UTC; manual dispatch is limited to the existing main workflow. No extra token, telemetry, user identifiers, private traffic, repository write permission, or provider billing access is needed. The console integration will fetch current public data through an owner-authenticated route, not expose private storage or use public artifacts as an authorization boundary.

Search Console aggregate data is intentionally separate; enabling it would require an explicit data access decision.
