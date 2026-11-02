Ad transcription outcomes
========================

The dedicated Meta transcript request remains GET with allow_long_transcription=false.
Do not enable the more expensive long-video mode during a repair or automatic retry.
Support documented data.transcript and legacy top-level transcript responses. Preserve
explicit zero credits, unknown charges and cached responses without inventing text.

Record successful, unavailable, duration-limited, failed, non-video and unrequested
outcomes separately. Retain all ad copy and video assets regardless of transcription.
Known duration-limit errors receive a clear message; unknown HTTP400 causes remain
unknown. Error response inspection is bounded to 16KiB and only fixed categories are
reported, never arbitrary upstream bodies or credentials. No paid automatic retry.

The 2026-10-18 historical 30-ad job is annotated from its existing journal and read-only
MP4 duration metadata: 9 transcripts, 4 empty responses, 4 HTTP400 videos above 120s,
13 non-video ads. Preserve its 17 requests, confirmed 9 credits and 30 evidence records.
The original HTTP400 response bodies were not retained, so the annotation distinguishes
measured duration from an unverified historical server reason. No provider replay or
model call is necessary for that annotation. Save a private checkpoint backup first.
