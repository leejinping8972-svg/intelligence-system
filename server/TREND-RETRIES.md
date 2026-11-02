Trends background retries
========================

Discovery and Semrush finish in the general runner. The checkpoint then moves to
trendQueueVersion=1. A separate, globally locked Trends runner processes one
keyword/period per dispatch. Ads, products, sites and metrics keep their existing
general runner. There is one Trends lane across server replicas, not one per task.

Annual and daily states are persisted independently as pending, running,
retry_wait, done, empty or failed. Each attempt is journaled before the request.
A restarted running attempt reuses the journal key and cached response. Only free
Trends failures can get a new retry attempt; paid request handling is unchanged.

429 honors Retry-After and uses 2/5/15/30/60 minute backoff with positive jitter.
The shared Trends provider cooldown applies across tasks. Network/5xx failures
use a per-step 30s/2m/5m/10m/20m delay and let other ready steps continue. Every
fourth dispatch admits a due retry so pending work cannot starve it. Five retries
are allowed after the initial attempt, with a 24 hour task supplementation limit.
Invalid parameters, authentication and malformed responses need manual attention.
Real zero heat and empty data are terminal outcomes, not network failures.

The task stays running while delayed work remains. Terminal partial results
explicitly retain their missing-step reasons. Percent measures processing, not
data completeness; ratings may be provisional. Metrics and associations are
preserved by the keyword upsert.

For deployment use deploy/server/drain-queue.mjs in a separate compose container
with the production private config and /release mount. Wait for its ready file
before replacing API code, and release both locks only after health checks and
any explicit checkpoint migration. Keep the old image and public/source archive
for rollback. Do not clear successful request journals or retry paid calls.
