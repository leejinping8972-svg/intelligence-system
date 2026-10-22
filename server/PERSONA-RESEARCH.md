# Persona driven consumer research

Base: confirmed testing `1e93b2958a4c39daf1fe2c0f9ca6c2f1a6f8d6da`.
Entry: consumer insights, "从人群画像研究". Existing keyword and country market reports remain available.

## Contract

- Independently enter country (VN/US/MX), age range, life stage, family role, research question, dates and request/credit limits. Zero requests reuses saved evidence only.
- A deterministic local-language vocabulary compiles stage and question themes into five layers per group: self, child, partner, elder, household. A local context override supports other wording. Age gap queries are retained for targeted follow-up; they do not prove identity and are not automatically charged.
- Saved products, ads, sites, public content, comments and country observation snapshots are candidates for reuse. Source buckets are sampled in a round robin per layer. Existing source records are not changed. New collection reuses ScrapeCreators configuration and existing product/comment normalizers; no model or new subscription is needed.
- Only the first page is requested. The journal is persisted before every paid request. Reserved, failed or unknown-charge outcomes halt paid collection and are never replayed automatically. Comment requests have a reserved share of the same total budget; each video is requested once. Cancellation stops subsequent requests and retains results.
- Retrieved, accepted, rejected and pending evidence are distinct. Reviewer assertions require an exact quote from that record and an eligible self-report class. All identity fields default to unknown; target membership, marketing and research inference cannot supply identity.
- Findings cite accepted evidence. Editing a cited item removes dependent findings until reviewed again. The report cannot be marked complete without all eight analytical sections, including explicit unverified findings where evidence is missing.
- Supply price/category/channel distributions use accepted product records and explicit denominators. They are not consumer spending, population statistics, conversion or independent efficacy evidence.

## Storage And Integration

- New namespace `persona:study:<uuid>` contains frozen reuse, request journal, review revision and findings. Reports use existing `business:insightReports`; study-specific evidence IDs use `business:researchEvidence:<study>:<source-id>`. No schema migration.
- New actions: `server_persona_preview`, `submit`, `detail`, `cancel`, `review`, `finalize`. Writes require admin. Mutations use the existing `insight-submit` lock, idempotent request IDs and review revision checks.
- Shared entry changes are limited to the API action dispatch, research runner dispatch/task label, consumer list/dialog, consumer report mounting, report type and lightweight summary. No `data.ts`, core-list parsers, product drawer, router or dependency manifests changed.
- Integration must retain both branches' narrow changes to `server/index.mjs` and `runner.mjs`. This feature does not depend on the four-core-list field delivery.
- Research business data, PDF, evidence exports and local QA fixtures are excluded from this commit. The actual VN report is a separate data deliverable; writing it does not deploy this feature.

## Verification

- `node --test server/persona-research.test.mjs server/market-research.test.mjs server/consumer-reports.test.mjs`
- `HCI_TEST_PGLITE_MODULE=<installed @electric-sql/pglite/dist/index.js> node --test server/persona-research.integration.test.mjs`
- Full application Vue type check and server/history production build, using an isolated `.artifacts/web-dist` output.
- Browser acceptance uses synthetic APIs only: preview, submit/navigation, exact evidence review, finding add/edit/delete, CSV export, a standalone printable report with all accepted evidence, desktop/mobile layout and script errors. No real accounts or paid sources are used by tests.

Local pnpm workspace links were damaged. Ignored materialized dependencies and source aliases were used for local type/build validation; dependency manifests and lockfiles were not changed. CI on the exact integrated SHA remains the integration gate. PGlite is local SQL evidence; no MySQL/Docker or remote CI result is claimed here.

## Limits

Public text and first-page ranking are convenience samples. Identity, location, medical status and order authenticity require separate verification. Unsupported countries require adding reviewed vocabulary/source mappings. Free-text life stages outside the vocabulary use a neutral local context or the explicit local context override. This feature does not automatically translate arbitrary text, recruit participants, validate medical claims or run population surveys.
