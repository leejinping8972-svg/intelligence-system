Product collection dispatch
===========================

productQueueVersion=2 checkpoints preserve per-site URLs, product IDs, visited URLs,
request counters and the last 200 logical page outcomes. productPolicyVersion=3
normalizes old queues without resetting any counters, saved products or deadline.
Each dispatch fetches at most one page and rotates through eligible sites.

All discovered and queued URLs are canonicalized before fetch and product upsert.
Reject encoded/raw template syntax, undefined/null, object-property links such as
/products/item.url and duplicate tracking/variant paths. Never request a placeholder.

Try Shopify public product JSON first when applicable. On an unavailable catalog,
use unvisited public sitemap, verified evidence page, Shopify collections/all and
home-page entry points. A 429 URL is rejected for this run; after the entire host
cools, try another entry, rather than repeating that URL. A rejected JSON catalog
also disables its pagination URLs. Three consecutive distinct 429 responses stop
the host, preserving products. Any successful response resets that consecutive
failure counter. No CAPTCHA solving, credential impersonation or paid scraper is
introduced. 403 remains manual attention.

Normal host pacing is 20-30 seconds, persisted across jobs/restarts. 429 cooldowns
are at least 10/30/60 minutes plus positive jitter and honor Retry-After when longer.
Do not immediately switch paths on a rate-limited host. Timeouts/network/5xx errors
retain bounded retries (2/5/15 minutes) and separate diagnostic labels. Other sites
continue. Budgets include failures/retries. The 24-hour deadline and total/per-site
request ceilings remain enforced. Redirects in the safe reader are part of one
logical page fetch, not separate quota entries.

Catalog images, price and variants are saved before fetching details. Missing
fields remain unknown. Preserve already collected values, favorites and first seen
metadata during upsert. Products are associated to keywords via source evidence or
saved site relationships. All fetches use pinned public DNS and official origins.

Terminal jobs are never silently reopened by initialization. resumeProductFallbacks
is an explicit bounded recovery for older HTTP429-blocked sites with remaining
budget/time and unvisited alternative entries. It retains all counters, product IDs,
request logs and the original deadline, skips the previously refused address, waits
30 minutes, and records a policy marker so the same recovery cannot repeat. Store a
private checkpoint backup before applying it while holding the runner deployment
locks. Completed and budget-exhausted sites remain terminal. No paid ad/Semrush calls
are made by this worker.
