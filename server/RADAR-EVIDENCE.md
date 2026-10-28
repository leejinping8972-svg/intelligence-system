# Radar evidence rules v2

- Discovery dates select the observation window; only supported public listing dates establish the existing 90-day listing status. This does not establish brand launch dates. Unknown listing dates cannot score 70 or higher for evidence completeness.
- The collector and radar share text rules. Disclaimer, safety, dosage and navigation text is excluded from benefits. Marketing badges and allergen exclusions are excluded from ingredient signals. Existing saved records are filtered during aggregation, without changing their source evidence.
- Case, punctuation, repeated tags and duplicate product membership do not inflate groups or brand counts. Unknown brand labels do not count as distinct brands. These groups remain observed selling points and ingredient mentions, with no novelty claim.
- Demand evidence must link to the actual products and market. Only comparable saved 30-day trends and current-window real ads contribute. Category-wide trends, stale ads, demo ads and brand counts alone cannot produce a score. Missing demand evidence yields a null score. Scores are heuristic leads, not validated profits or supply feasibility.
- Recall signals remain in regulatory coverage and are not counted as ingredients. Public label entry dates do not confirm listing dates.
- Summaries include source-confirmed listing counts and the number of scored records. Reports and the UI use evidence completeness and lead scores, not confidence probabilities or commercial opportunity claims.
- Rule version 2 is persisted separately from storage format 4. The next background statistics check after 09:00 Shanghai rebuilds a previous-rule snapshot once, even if it already ran that day. Subsequent runs keep the daily schedule. Replacement is atomic; failure keeps the saved snapshot for retry. The UI hides obsolete-rule findings/scores until replacement, and report generation rejects obsolete-rule snapshots. No business records, collection tasks or paid requests are modified.
- Synthetic verification: `node --test server/radar-evidence.test.mjs server/workspace-statistics.test.mjs workers/site-discovery/test.mjs`, after rebuilding `server/model.js` and `server/collector.js` with the existing esbuild commands.

## Delivery Verification (2026-10-28)

- 42 Node tests passed, including collector compatibility, exclusion boundaries, same-day rule upgrades, bounded pagination and PGlite atomic replacement/failure recovery.
- 19 Vitest tests passed for discovery, saved statistics queries and trend comparisons. Full web type checking and targeted ESLint passed.
- Server/history frontend built in the feature worktree's ignored `.artifacts/frontend`. The checked-in model and collector bundles were rebuilt from source.
- Browser checks used only computed synthetic records with external requests blocked. Desktop 1440x1000 and mobile 390x844 covered confirmed listing totals, null scores, noise exclusion, filters, pagination, evidence details and old-rule snapshots. No page errors or mobile page overflow. Screenshots and the result JSON are in the worktree's ignored `.artifacts` directory.
- No production changes, real collection, paid calls, schema changes or business-data migration. Integration must take this feature commit, allow the normal background statistics check to replace the old rule snapshot, and verify rule version 2 before treating the displayed totals as refreshed.
