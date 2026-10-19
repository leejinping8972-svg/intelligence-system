import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAdTranscript,
  transcriptFailure,
  transcriptSummary,
} from './ad-transcript.mjs';
import { scrapeRequest } from './ads-provider.mjs';
import { runInsightJob } from './insight-jobs.mjs';
test('transcript normalization accepts nested and legacy envelopes and real zero charges', () => {
  assert.equal(
    normalizeAdTranscript({
      data: { transcript: 'nested text', transcript_available: true },
      credits_charged: 1,
    }).text,
    'nested text',
  );
  assert.equal(
    normalizeAdTranscript({
      transcript: [{ text: 'one' }, { text: 'two' }],
      credits_charged: 0,
    }).text,
    'one\ntwo',
  );
  assert.equal(
    normalizeAdTranscript({ cached: true, data: { transcript: 'cache' } })
      .creditsCharged,
    0,
  );
  const empty = normalizeAdTranscript({
    data: { transcript: null, transcript_available: false },
    credits_charged: 0,
  });
  assert.equal(empty.status, 'unavailable');
  assert.equal(empty.creditsCharged, 0);
  assert.equal(
    normalizeAdTranscript({ data: { transcript: 'text' } }).creditsCharged,
    null,
  );
});
test('duration refusals are explicit while provider secrets and arbitrary errors are never echoed', async () => {
  const e = await transcriptFailure(
    new Response(
      JSON.stringify({
        error: 'duration exceeds 120 seconds; api_key=DO-NOT-LEAK',
      }),
      { status: 400 },
    ),
  );
  assert.equal(e.reason, 'duration_limit');
  assert.equal(e.httpStatus, 400);
  assert.match(e.message, /120秒/);
  assert.ok(!e.message.includes('DO-NOT-LEAK'));
  const unknown = await transcriptFailure(
    new Response('DO-NOT-LEAK', { status: 400 }),
  );
  assert.equal(unknown.reason, 'provider_error');
  assert.ok(!unknown.message.includes('DO-NOT-LEAK'));
  const invalid = await transcriptFailure(
    new Response('duration must be positive', { status: 400 }),
  );
  assert.equal(invalid.reason, 'provider_error');
});
test('transcript request stays GET with paid long mode disabled and exposes classified failure', async () => {
  let count = 0;
  await assert.rejects(
    scrapeRequest(
      '/v1/facebook/adLibrary/ad/transcript',
      { id: '123', allow_long_transcription: false },
      'QA-key',
      async (url, options) => {
        count++;
        assert.equal(options.method, 'GET');
        assert.equal(url.searchParams.get('id'), '123');
        assert.equal(url.searchParams.get('allow_long_transcription'), 'false');
        assert.equal(options.body, undefined);
        return new Response('{"message":"video duration is too long"}', {
          status: 400,
        });
      },
      'GET',
    ),
    (e) => e.reason === 'duration_limit',
  );
  assert.equal(count, 1);
});
test('ad analysis separates successful, empty, long, other failures and non-video records without retries', async () => {
  const docs = new Map(),
    saves = [];
  let calls = 0;
  const records = Array.from({ length: 5 }, (_, i) => ({
    id: 'a' + i,
    archiveId: String(i + 1),
    brand: 'Brand' + i,
    copy: 'Original copy',
    videoUrls: i < 4 ? ['https://video.example/x'] : [],
    evidenceUrl: 'https://facebook.com/ads/library/?id=' + i,
    market: 'US',
  }));
  await runInsightJob(
    {
      id: 'qa',
      input: {
        kind: 'ad_analysis',
        records,
        fetchTranscript: true,
        maxRequests: 4,
        title: 'Test',
        market: 'US',
      },
      checkpoint: {},
    },
    {
      cancelled: async () => false,
      read: async (k) => docs.get(k),
      put: async (k, v) => docs.set(k, structuredClone(v)),
      saveCheckpoint: async (j, cp, status) =>
        saves.push({ cp: structuredClone(cp), status }),
      collect: async () => {
        const n = calls++;
        if (n === 0) return { text: 'Transcript', creditsCharged: 1 };
        if (n === 1) return { text: '', creditsCharged: 0 };
        if (n === 2)
          throw Object.assign(new Error('long video'), {
            reason: 'duration_limit',
            httpStatus: 400,
          });
        throw new Error('other failure');
      },
    },
  );
  assert.equal(calls, 4);
  const cp = saves.at(-1).cp;
  assert.deepEqual(cp.transcriptSummary, {
    collected: 1,
    unavailable: 1,
    limited: 1,
    failed: 1,
    notVideo: 1,
    skipped: 0,
  });
  assert.equal(cp.requests, 4);
  assert.equal(cp.creditsCharged, 1);
  assert.equal(cp.evidenceIds.length, 5);
  assert.equal(docs.get('insightReports:qa').transcriptSummary.limited, 1);
  assert.ok(
    [...docs.values()]
      .filter((v) => v.text)
      .every((v) => v.text.includes('Original copy')),
  );
});
test('summary only counts recorded outcomes; unknown status does not imply success', () => {
  assert.deepEqual(transcriptSummary({ a: { status: 'pending' } }), {
    collected: 0,
    unavailable: 0,
    limited: 0,
    failed: 0,
    notVideo: 0,
    skipped: 0,
  });
});
