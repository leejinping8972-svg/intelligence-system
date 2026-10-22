# Statistics Read Path Audit

Baseline: `26998b756e7286590409ff68fd1301ab12423f2d` (2026-10-22).

| Area | Finding | This change |
| --- | --- | --- |
| Overview, keyword, product, site, ad lists | Already use persisted projections and pagination | Preserve existing paths |
| New-product radar | Page header selected legacy sync; full business data loaded and repeatedly grouped in browser | Background snapshots for 3/7/14/30 days, market and type; SQL pagination; full-result counters and activity; explicit full report |
| Opportunity research | Full workspace sync and nested product/site scans; unlimited DOM rows | Background grouping and pagination; saved-only filtering before pagination |
| Popular formulas | Browser grouped only the products loaded by other pages, so totals could be incomplete | Full projected dataset aggregation and coverage, lazy dialog request, paged groups |
| Trend research | Full workspace load although only one keyword chart was needed | Remote keyword search and selected-keyword detail request |
| Report lists | Full report documents, including frozen market product samples, loaded for each list request | Persisted compact report summaries, with an overlay of unindexed changed reports; details unchanged |
| Task and focused-monitor lists | Compact task mode and separate monitor overview already exist | No global rewrite needed |
| Public signals and consumer-report pages | Some headers still select legacy workspace sync; public static signals are downloaded as a whole | Follow-up: scoped remote selectors before removing legacy sync, plus paged public signals. Preserve existing selectors in this batch |

## Derived Storage

`workspace_statistic_rows` stores paged radar findings, opportunity groups and formula groups. It contains only rebuildable derived records. Metadata is stored in `read:statistics:*` documents, outside the business sync channel. The existing `workspace-reads` lock serializes background generation; the request path never performs source-wide computation. Each rebuild commits atomically; readers use a consistent read transaction. A failed generation keeps the previous snapshots and does not roll back successful source projections.

Data writes trigger the existing invalidation queue. After the queue drains, background generation publishes snapshots; idle time-based recomputation occurs every five minutes. Public observation feeds are read only by the worker, with a three-second timeout per feed, a sixteen-MiB bound, five-minute cache, and persisted last-good data. No collection, model, or paid provider calls are made by statistics requests.

Formula heat uses product and brand counts plus review snapshots. Unknown-period sales and monthly sales are no longer added together. This is an observed sample ranking, not market sales or growth.

The frontend keeps bounded per-user query caches, coalesces duplicate requests, rejects stale market responses and stops polling when inactive. Charts reuse their instance when the theme is unchanged.

## Verification Boundaries

Use synthetic records and the disposable PostgreSQL/MySQL workspace-read fixture. Test complete counts versus pages, market isolation, full report export, saved-only filters, source invalidation/deletion, malformed-record isolation and immediate visibility of report changes. No production data or provider keys are needed. Local results do not establish production response times; deployment and actual browser timing remain separate release checks.

Local verification completed: 12 frontend query/radar tests, 6 final Node tests (including a disposable PGlite projection/invalidation integration), full frontend typecheck, server/history production build and generated layout validation. Browser checks use synthetic API responses at desktop and 390px widths: radar pagination and complete report, opportunity pagination, lazy formula totals, selected-keyword trend detail, no full workspace delta request and no page script errors. MySQL/Docker and production latency remain release checks.
