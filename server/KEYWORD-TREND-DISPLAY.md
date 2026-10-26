# Keyword Trend List Display

- Keyword pages return a saved annual curve and four calendar period summaries in one bounded page query. Existing v6 projections are enriched from saved keyword records without rebuilding the read index or calling a collection provider.
- Research and selected keyword lists render the annual curve directly. The full chart and research detail open before their detail requests finish. Research detail includes loading, retry, close and late-response guards.
- Social snapshots merge by requested keyword ID, preserve other pages and retain existing values on read failure. Missing saved summaries, loading and failed reads have distinct labels. Existing legacy sample counts remain marked as requiring historical comparison.
- Popular and rising query cells open a scrollable popover containing every saved query and its provider value. Both lists and the detail panel reuse the same component. The compact cell is a preview, and the visible count is the number returned by the saved source, not all possible searches.

## Verification

45 focused frontend tests passed, including calendar summary parity, zero curves, date spacing, missing-source labels, request deduplication and out-of-order page responses. The workspace read model suite passed against isolated PGlite, including a stale v6 projection enriched from saved keyword data. Full web type checking, server/history preview build and focused component/module lint passed.

Local browser checks used synthetic data and a four-second detail delay: the drawer appeared with loading feedback before the response; close, switching records, error and retry were exercised. Popular and rising popovers contained all 25 saved synthetic queries including the final item. No collection or paid provider requests were submitted. Production data and real provider coverage were not inferred from these checks.

No schema, migration, dependency, task execution or provider configuration changes.
