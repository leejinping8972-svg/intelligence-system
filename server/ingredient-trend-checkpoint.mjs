import { trendHash } from './ingredient-trend-domain.mjs';

// References are immutable. A crash between archive writes and checkpoint
// commit still reads the previous state and reuses the same paid request step.
export function sampleSummary(sample, stateKey) {
  return {
    postId: sample.post.id,
    stateKey,
    unique: sample.ids.length,
    observed: sample.runIds.length,
    pendingCount: (sample.pending?.length || 0) + (sample.bufferedPage ? 1 : 0),
    buffered: Boolean(sample.bufferedPage),
    blocked: sample.blocked,
    pages: sample.pages || 0,
    missingCursor: sample.missingCursor,
    countsMatch: sample.countsMatch === true,
  };
}
export async function storeSamples(job, samples, archive) {
  const entries = samples.map((sample) => [
    `ingredient-trend:sample:${job.id}:${sample.post.id}:${trendHash(sample).slice(0, 24)}`,
    sample,
  ]);
  await archive.writeMany(entries);
  return samples.map((sample, index) =>
    sampleSummary(sample, entries[index][0]),
  );
}
export async function loadSample(summary, archive) {
  if (summary.post) return summary;
  const sample = await archive.read(summary.stateKey);
  if (
    !sample?.post ||
    !Array.isArray(sample.pending) ||
    !Array.isArray(sample.ids) ||
    !Array.isArray(sample.runIds)
  )
    throw new Error('评论断点归档缺失，已停止继续请求');
  return structuredClone(sample);
}
export async function compactSamples(job, cp, archive) {
  if (cp.phase !== 'comments' || !cp.samples?.some((sample) => sample.post))
    return;
  cp.samples = await storeSamples(job, cp.samples, archive);
  cp.sampleStorageVersion = 1;
}
export async function compactAnalysis(job, cp, archive) {
  if (cp.analysisRecords) {
    const entries = [];
    for (let offset = 0; offset < cp.analysisRecords.length; offset += 80) {
      const value = cp.analysisRecords.slice(offset, offset + 80);
      entries.push([
        `ingredient-trend:analysis:${job.id}:${offset}:${trendHash(value).slice(0, 24)}`,
        value,
      ]);
    }
    await archive.writeMany(entries);
    cp.analysisRecordKeys = entries.map(([name]) => name);
    cp.analysisRecordCount = cp.analysisRecords.length;
    delete cp.analysisRecords;
  }
  if (cp.findings) {
    cp.findingCount = cp.findings.length;
    const key = `ingredient-trend:findings:${job.id}:${trendHash(cp.findings).slice(0, 24)}`;
    if (cp.findingsKey !== key) await archive.write(key, cp.findings);
    cp.findingsKey = key;
    delete cp.findings;
  }
}
export async function analysisBatch(cp, archive) {
  if (cp.analysisRecords)
    return cp.analysisRecords.slice(cp.analysisOffset, cp.analysisOffset + 40);
  const start = Math.floor(cp.analysisOffset / 80),
    end = Math.floor((cp.analysisOffset + 39) / 80);
  const keys = cp.analysisRecordKeys.slice(start, end + 1);
  const records = await archive.readMany(keys);
  const values = keys.flatMap((key) => {
    if (!Array.isArray(records.get(key)))
      throw new Error('分析资料归档缺失，已停止继续请求');
    return records.get(key);
  });
  const batch = values.slice(
    cp.analysisOffset % 80,
    (cp.analysisOffset % 80) + 40,
  );
  if (batch.length !== Math.min(40, cp.analysisRecordCount - cp.analysisOffset))
    throw new Error('分析资料归档不完整，已停止继续请求');
  return batch;
}
