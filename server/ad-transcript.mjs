// Accept both the documented nested envelope and older top-level responses.
export function normalizeAdTranscript(payload) {
  const data =
    payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object')
    throw new Error('转录接口返回结构异常');
  const raw = data.transcript ?? data.transcription ?? data.text;
  const text = (
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((r) => r?.text || '').join('\n')
        : raw?.text || ''
  )
    .trim()
    .slice(0, 20000);
  const charged = payload.credits_charged ?? data.credits_charged;
  return {
    text,
    status: text ? 'collected' : 'unavailable',
    message: text
      ? '已取得视频文本'
      : '平台未返回可用转录文本；视频与广告文案仍保留',
    creditsCharged:
      payload.cached === true
        ? 0
        : Number.isFinite(charged) && charged >= 0
          ? charged
          : null,
  };
}
export async function transcriptFailure(response) {
  // Only recognize fixed error categories. Never echo provider bodies or credentials.
  const reader = response.body?.getReader();
  let text = '';
  if (reader) {
    const chunks = [];
    let bytes = 0;
    try {
      while (bytes < 16384) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.subarray(0, 16384 - bytes));
        bytes += value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  const long =
    response.status === 400 &&
    /too.?long|120\s*(?:seconds|secs|s\b)|allow_long_transcription|exceed.*(?:duration|length|minute)/i.test(
      text,
    );
  return Object.assign(
    new Error(
      long
        ? '视频超过默认120秒AI转录上限；长视频付费模式未开启，广告文案仍可分析'
        : `ScrapeCreators HTTP ${response.status}：${response.status === 400 ? '视频转录请求被拒，具体原因未识别；不会自动重复请求' : response.status === 429 ? '上游限流' : '转录接口请求未成功'}`,
    ),
    {
      httpStatus: response.status,
      reason: long ? 'duration_limit' : 'provider_error',
    },
  );
}
export function transcriptSummary(results) {
  const summary = {
    collected: 0,
    unavailable: 0,
    limited: 0,
    failed: 0,
    notVideo: 0,
    skipped: 0,
  };
  for (const result of Object.values(results || {})) {
    const field = {
      collected: 'collected',
      unavailable: 'unavailable',
      duration_limit: 'limited',
      failed: 'failed',
      not_video: 'notVideo',
      skipped: 'skipped',
    }[result.status];
    if (field) summary[field]++;
  }
  return summary;
}
