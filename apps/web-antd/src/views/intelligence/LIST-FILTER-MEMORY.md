# Keyword reviews and list filter memory

Keyword research previously reported a successful review change immediately after
editing local state. `saveKeywordReviews` now initializes/awaits any background
sync, queues the selected IDs explicitly, and waits until every selected edit has
been acknowledged. Requests keep the existing 100-keyword batch limit. Failed
writes surface an error and remain available for retry. Removing an item from the
selected list uses the same save path. This does not submit collection jobs.

`useListFilterMemory` stores only registered list controls in browser localStorage,
using separate keys for the signed-in account and each list. Keyword research,
selected keywords, products, sites and ads restore search, their filter controls,
date ranges, sorting, period, page size and display mode where available. Product
pool/listing controls and site/keyword associations are included. Explicit route
parameters take priority; an ordinary visit preserves the saved controls. Record
checkboxes, dialogs and collection form inputs remain transient. Invalid saved
values or blocked browser storage fall back to usable defaults. This is browser
memory and does not synchronize filters between devices.

The selected keyword list provides an explicit search button and sorts globally
by `collectedAt` through the existing server list query. It displays the keyword's
actual capture time in Beijing time. Site job submission/start/finish times are
kept separate from the keyword capture timestamp.

Validation uses synthetic local data only: keyword sync/save tests, list memory
tests, route filter tests, existing workspace query/change tracker tests, full web
type checking, an isolated server-mode web build, and browser navigation/reload
checks. The full type check retains the existing `basic.vue:74` `closeMenu` slot
error; the unchanged file has the same blob as the previously verified baseline.
No backend schema, migration, provider calls or production data changes are part
of this feature.
