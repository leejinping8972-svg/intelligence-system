# Login and Startup Performance

Baseline: `87e33c289bef8672d5ecc17f69ad2abcad42e290` (2026-10-23).

## Changes

- Start public branding and the cookie session check alongside application loading. Cached branding still applies immediately, and late server branding still updates the mounted application.
- Share in-flight session checks. Adopt the authenticated login/setup response directly, avoiding a second `auth_status` request. Session revisions prevent late status or unauthorized responses from overwriting a newer login.
- Load framework form/component adapters on demand. The native server login uses Ant Design forms; other routes initialize adapters before mounting, including layout widgets. The first route is ready before the startup overlay is removed.
- Combine account lookup and account/IP lockout checks into one database read. Run the four required successful-login writes concurrently and wait for every write to settle before responding, including failure paths. A failed required write cannot issue a login cookie.
- Perform expired-session housekeeping after successful login, at most once per process per 15 minutes. Failed cleanup can retry after one minute on a subsequent login. Session expiry, account enablement and revocation remain checked on each authenticated request.
- Use a bounded lookup for initial-account status and avoid that lookup when an authenticated user already establishes that setup is complete. Password login and initial setup authenticate directly without querying an unrelated old session cookie first.

No schema, provider, dependency or data migration is required.

## Local Measurements

All records and accounts are synthetic. These measurements do not establish production latency.

The browser fixture uses the exact baseline build receipt and a new server/history production-mode build. Chrome runs with a fresh context per viewport; public branding is delayed 3000 ms, `auth_status` 600 ms and `auth_login` 600 ms. Only localhost requests are allowed. Browser timings below are one comparison run per viewport.

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Interactive login, 1440 x 1000 | 2564 ms | 1079 ms |
| Interactive login, 390 x 844 | 2956 ms | 1008 ms |
| Login click to overview, desktop | 1620 ms | 982 ms |
| Login click to overview, mobile | 1577 ms | 943 ms |
| Existing-session reload, desktop | 2964 ms | 1096 ms |
| Existing-session reload, mobile | 2947 ms | 1064 ms |
| JavaScript decoded before login | 1,589,064 bytes | 1,056,371 bytes |
| Session status requests across login | 2 | 1 |

The JavaScript count measures decoded local response bytes, not compressed production transfer. The fixtures showed no page script errors or horizontal document overflow at either viewport. External icon requests were blocked, so their network behavior was not validated.

The independent server benchmark uses real scrypt with 100 ms synthetic latency per database query and five successful logins per version. Median authentication time was **854 ms to 311 ms**. Queries before the response fell from seven serial operations to five operations in two rounds: one read followed by four concurrent writes. Browser API responses remain fixed at 600 ms, so the browser comparison does not include this server improvement.

## Verification

- 32 frontend checks: application scheduling, adapter navigation/initialization, session races, real Ant Design form submission, existing branding retries and SSO navigation.
- 37 Node checks including disposable PGlite authentication SQL, password policy and SSO protocol. Authentication cases include setup protection, account/IP lockout, disabled/expired/revoked sessions, password change, audit failure with a suspended session write, and housekeeping failure/retry.
- Complete web-antd typecheck, server/history production-mode build and generated layout utility verification passed. Changed frontend files and new test scripts passed focused lint; existing whole-file server lint issues are not reported as passing.
- CI includes the new startup and authentication regression tests. Remote CI, actual MySQL8 execution, real-account SSO and production latency were not exercised locally.

Useful reproduction commands from the feature worktree:

```sh
pnpm exec vitest run tests/application-startup.test.ts tests/component-adapter-startup.test.ts tests/session-startup.test.ts tests/admin-login.test.ts tests/public-branding.test.ts tests/admin-sso.test.ts
node --test server/auth-performance.test.mjs server/password-policy.test.mjs server/admin-sso.test.mjs
node tests/auth-login-benchmark.mjs
node tests/startup-performance-ui.mjs PATH_TO_BASELINE_BUILD baseline
node tests/startup-performance-ui.mjs .artifacts/startup-performance/frontend optimized
```

Local evidence is under `.artifacts/startup-performance/`: baseline and optimized JSON, browser screenshots, authentication benchmark and build log. `tests/startup-performance-ui.mjs BUILD_DIRECTORY preview` starts a localhost-only preview with synthetic responses and prints its URL. Its login/overview flow accepts synthetic input and is not a real authentication environment.

Delivery state: feature complete and locally verified; pending integration and release. No production deployment was performed by this task.
