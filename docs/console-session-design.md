# First-party console sessions

Refs #251. This design is not the implementation or a production rollout.

## Boundary

GitHub OAuth verifies the configured stable owner ID with the existing `read:user` scope and account-selection behavior. Auth.js remains the OAuth callback and CSRF handler. Never persist GitHub provider access or refresh credentials. An authenticated callback must issue a fresh single-use bootstrap, not leave a reusable Auth.js session capable of minting first-party sessions after logout. In the new mode every console data read and write must require first-party authorization; legacy cookie fallback is prohibited.

## Lifetime and state

- Use opaque, cryptographically random first-party access and refresh credentials in Secure, HttpOnly, SameSite cookies restricted to the console host. JavaScript receives only session availability, never token values. Do not accept credentials from query parameters or request bodies.
- Access lifetime: at most five minutes. Refresh family absolute expiration: eight hours from the successful owner sign-in, never extended by refresh. Enforce expiry on the server, independently of cookies or client timers.
- Store only keyed digests of credentials, stable owner ID, family ID, generation, creation and expiry times, and revocation state. Do not store raw credentials, provider tokens, IP addresses or request bodies. Use a separate versioned key namespace.
- A bounded per-owner family index allows at most eight active families. Expired records are removed by TTL; revocation tombstones expire at the original absolute boundary. Reaching capacity refuses a new session or requires explicit logout rather than evicting active sessions silently.

## Atomic refresh and logout

Use the existing operator store only if its approved write permission already covers the new namespace. No new token or store grant is authorized by this design. Use one atomic Redis operation for generation checks, replacement, bounded indexing and TTL. A multi-command pipeline alone is not atomic. Only one concurrent refresh may win. A losing legitimate request receives a retryable response without Set-Cookie or cookie clearing, so it cannot overwrite the winner. Client requests serialize refresh; do not automatically retry stale refresh indefinitely. Replays outside the short concurrency window revoke the family. The server never returns a previous raw refresh token.

A logout POST checks the configured same origin and CSRF protection, revokes the family atomically, and clears both first-party cookies and the Auth.js bootstrap cookie. An unavailable store is a failed logout, not a claim of successful revocation; clear browser access and return explicit retry guidance. Access checks must consult authoritative revocation and expiry state even before the five-minute access lifetime ends. Store errors deny access; there is no fallback to the previous JWT mode. A fresh login uses the GitHub account picker.

## Verification gates

- Offline synthetic tests: verified owner and non-owner callbacks, single-use bootstrap, session fixation prevention, absolute expiry, expired access with valid refresh, concurrent refresh winner/loser, stale refresh replay, logout with access and refresh, unavailable store, missing config, invalid origin and malformed input.
- Test each protected read and mutation route and public session endpoint. Confirm cookie flags and that no secrets, raw tokens, URLs or provider credential data appear in logs or payloads.
- Validate capacity/TTL and command budget against the existing operator store and verify atomicity with a staged isolated test namespace. Use synthetic fixtures only, with no production credential values in test output.
- Stage the complete mode and verify owner access, non-owner denial, logout and fresh sign-in before promotion. Do not deploy the new mode until the exact reviewed implementation and staging pass; never change worker or GitHub App permissions.
- Rollback must be explicitly reviewed: never silently re-enable acceptance of legacy cookies after a revocation. Existing sessions should require new sign-in when migrating between modes.

## References

- [Auth.js session strategies](https://authjs.dev/concepts/session-strategies)
- [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi)
