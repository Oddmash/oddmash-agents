# Organization policy coverage and model cost

On 2026-11-25 the canonical public organization AGENTS.md and docs/AI-CODE-REVIEW.md were 20,954 and 13,116 UTF-8 bytes respectively (34,070 combined). The earlier 12,000-byte individual limit and shared 24,000-byte guidance allowance excluded both.

The organization documents have a separate 48,000-byte combined limit, with 32,000 bytes per document; project-specific guidance retains the previous independent 24,000-byte budget. The retrieved file path, size, blob hash, base64 and UTF-8 bytes are validated whether retrieval is authenticated or anonymous. Missing, malformed, oversized or unavailable organization evidence causes COMMENT for public reviews and fails closed for private reviews. No silently truncated document can authorize approval or merge.

This increases the model input relative to silently omitted guidance. The existing total model request byte cap remains authoritative; if the configured model cap is exceeded, no approval is issued. Place stable guidance first in model input to make repeated prefixes eligible for provider caching where supported, but measure observed usage before claiming cost savings. A future compact organization policy representation needs explicit policy review and revision tracking.
