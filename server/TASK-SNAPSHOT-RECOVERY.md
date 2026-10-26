# Task Snapshot Recovery

The persisted `bulk_semrush_enrichment` contract contains `work` rather than
keyword `seeds`, `markets` and `sources`. Previously its keyword projection threw
and aborted the complete task snapshot.

`task-projection.mjs` recognizes this contract and returns read-only saved
checkpoint summaries. `bulk_running` is labeled as requiring confirmation,
since a persisted status does not establish that a process is alive. Counters
retain real zero values and distinguish missing values. Markets come from the
saved work; absent coverage is explicitly unrecorded. Input, credentials,
targets and raw errors are excluded from these summaries.

Both task detail and snapshots use the protected projection. Unsupported or
malformed jobs retain a visible read-only placeholder while other tasks remain
available. Snapshot database failures still propagate normally.

No schema, migration, task status, runner, request journal or paid request is
changed. Existing jobs are not restarted or replayed.

Feature verification: Node task projection, snapshot and keyword progress tests;
Vitest task grouping and cloud workspace tests; web application type checking.
