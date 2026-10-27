# Unified keyword trends and saved radar candidates

## Keyword research

- New research and selected-word supplementation accept optional `socialTrends` with TK/INS/FB sources, daily shared request cap, page cap and explicit configured-credit acknowledgment. Google continues through its existing queue. Legacy submissions without this field do not initiate social collection.
- The server validates the plan and requires an administrator and an existing ScrapeCreators configuration. Social names never enter the keyword discovery collector. Submission deduplication includes the selected social sources and budgets.
- After discovery saves canonical keyword IDs, the runner dispatches social work under `competitor-runner`. Work and a durable `keyword-trends:research:<jobId>` marker commit together. A busy lock defers the research with its checkpoint; a restart after dispatch reuses the marker, including across midnight.
- Existing same-day source/page keys, request journals, unknown-charge gate and shared budgets remain in force. A cancelled parent cannot start another request; shared work proceeds while another requesting parent is active. A deliberate manual resubmission can own shared pending work independently.
- Lists show queued work immediately and successful saved periods when available. Google/research completion does not establish social historical coverage; missing pages and partial samples remain explicit. This change does not enable a daily social plan or submit old keywords automatically.

## Radar storage and refresh

- Existing table `workspace_statistic_rows` stores independent compressed candidates with `kind=radar-data`, `market=ALL` and `variant=3/7/14/30`. Market/type indexes under `kind=radar` reference candidate positions. Each candidate is saved once per observation window and reused across market views.
- List requests read the saved summary, current page indexes, and only those candidate rows. A 20-row page reads and decompresses 20 candidates. Full report export deliberately reads all matching candidates in bounded batches. Opening a page never invokes source collection or recomputes radar findings.
- The existing workspace background worker starts one daily aggregation at 09:00 Asia/Shanghai (UTC+8), independently of page visits and source revision changes. Radar, opportunities and formulas share this schedule and atomic snapshot. Raw collection and derived-index processing retain their existing schedules. New observations appear after the next successful daily aggregation.
- The persisted successful snapshot timestamp prevents duplicate same-day runs after restarts. A delayed or unavailable worker catches up once after 09:00; failed transactions preserve the previous snapshot and retry after at least one minute. The daily check runs before each derived-index batch, so a nonempty queue does not postpone aggregation until it drains. Lock contention and aggregation duration can delay completion beyond 09:00.
- Aggregation evaluates the compact projections available when it starts. Persistence compares rows and only writes changed positions, removing expired tails. It does not recalculate when an incremental projection finishes. The public-feed cache TTL only caches saved feed reads; it does not schedule aggregation or source collection.
- Version 4 replaces the old whole-window compressed document. The replacement, candidate indexes and summaries switch in one transaction. Failed refreshes retain the prior usable snapshot. Pre-upgrade snapshots remain readable until their background replacement succeeds; old compressed documents are removed only in that successful transaction.
- The page preserves summary totals during pagination, debounces change notifications and displays loading until an initial snapshot exists. Read failures retain the previous successful result. No schema or business-data migration is required.

## Verification

Synthetic-only tests cover canonical keyword dispatch, explicit credit consent, duplicate submissions, cross-midnight checkpoint recovery, transaction rollback, cancellation, original Google/metric pipeline, cold bounded pagination, filters/export, old snapshot compatibility, failed background replacement, revision updates, unchanged-row writes and rolling-window expiry. Browser checks cover both submission dialogs, slow radar loading, pagination and desktop/mobile controls. No real provider request is needed for these checks.
