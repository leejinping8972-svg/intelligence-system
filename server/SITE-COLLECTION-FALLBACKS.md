# Site collection fallbacks

Feature branch based on testing `9c977913bb8bb11941241ca617da168c4602d97b`. No production changes or paid probes are part of this delivery.

## Behavior

- Existing public catalog and sitemap discovery, round-robin scheduling, 20–30s host pacing and durable 429 cooldown remain. `Retry-After` can extend the cooldown. A 429 does not immediately switch addresses, browsers or providers.
- New site-product jobs can render dynamic pages on a later dispatch, after normal host pacing. Default batch limit: 5 browser pages; 0 disables rendering. Existing queued jobs do not acquire new fallback budgets on deployment.
- Firecrawl is optional: encrypted administrator configuration must enable it, and an administrator must set a positive per-task `maxPaidRequests` (default 0). Saving settings never probes the provider. No automatic purchases. This counts attempts, not guaranteed monetary or credit costs.
- Page budget and per-site budget include direct, rendered and hosted attempts. Renderer resource requests are separately bounded to 12 textual resources per page, 6MB aggregate and 30 seconds. Images are saved as links, not downloaded. Formula text inside images remains unknown.
- Direct 403 and repeated 429 may schedule an explicitly budgeted hosted attempt after cooldown. Hosted failure ends this site's attempts. Counters are reserved before the request and saved in the checkpoint. An in-flight hosted request found after restart ends as partial/unknown; it is never automatically replayed.
- Progress includes browser/hosted counters, limits, per-page method in the request log and extraction provenance on saved products. Successful extraction does not erase older ingredient/image/serving evidence when the new response lacks those fields.

## Runtime and integration

- New `playwright-core` dependency is pinned in server package.json/package-lock.json. The API image adds Alpine Chromium and `PRODUCT_BROWSER_EXECUTABLE=/usr/bin/chromium`. No workspace dependency changes.
- Browser uses a fresh non-persistent context, Chromium sandbox, no user cookies and a sanitized environment. All document/script/CSS/GET data requests are fulfilled by the DNS-pinned public reader; non-GET, downloads and WebSockets are blocked. A non-routable proxy blocks browser network paths outside interception. Private DNS answers and off-site navigation are rejected. No captcha solving or login automation.
- The production container must support the Chromium sandbox as the existing non-root `node` user. This machine has no Docker; the image and Linux sandbox must be verified in isolated CI/integration before deployment. Do not weaken the sandbox automatically. If unavailable, the task records the reason and keeps its saved data.
- No schema migration. Config key is `provider:site-fetch:v1`; public status excludes ciphertext and API key. `server_site_fetch_config` is admin-only; `server_site_fetch_status` is authenticated. Blank Key preserves the existing encrypted Key.
- Small shared-entry changes: settings component mount, product dialog budgets, task counter fields/view, API config routes and product submission user context, safe reader content type and scoped/manual redirects. Keep other feature branches' changes when merging. Testing workflow adds mocked fallback regressions.
- Existing historical failed jobs are not reopened or resubmitted. Production source/data/queues and `public/data` have not been touched.

## Verification

- `node --test server/site-page-fallbacks.test.mjs server/product-queue.test.mjs server/platform-products.test.mjs server/platform-product-completion.test.mjs server/market-jobs.test.mjs server/enrichment.test.mjs server/job-progress.test.mjs`
- Synthetic local Chromium QA: `PRODUCT_BROWSER_QA_EXECUTABLE=<local Chrome path> node server/site-browser.qa.mjs`. Mocked resource responses render a JS-inserted product and reject a private-network request, with no external traffic.
- Frontend typecheck and production/history build in this worktree. `node tests/site-fallback-ui.qa.mjs` checks settings defaults, key clearing/non-persistence, and zero-paid task submission using synthetic APIs.
- Real Firecrawl Key permissions, account credit costs and target-site success rates are not validated; no real paid requests were made.
