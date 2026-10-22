import { mergePersonaEvidence, personaEvidence, personaReport } from './persona-research-domain.mjs';

export async function executePersonaStudy(study, io) {
  study.status = 'running';
  if (await io.cancelled()) { study.status = 'cancelled'; await io.save(study); return io.publish(personaReport(study, study.evidence), study.evidence); }
  if (!study.reuseFrozen) {
    const existing = await io.existing(study.plan.market);
    for (const q of study.queries) {
      const matches = existing.filter((r) => new RegExp(q.pattern, 'iu').test(r.text || r.title || r.summary || ''));
      // Round robin sources, rather than letting the largest product pool fill a layer.
      const groups = new Map();
      for (const r of matches) {
        const key = `${r.kind}:${r.platform || r.sourcePlatform || r.source}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const selected = [];
      while (selected.length < study.plan.budget.perQuery && [...groups.values()].some((g) => g.length)) {
        for (const g of groups.values()) if (g.length && selected.length < study.plan.budget.perQuery) selected.push(g.shift());
      }
      study.evidence = mergePersonaEvidence(study.evidence, selected.map((r) => personaEvidence(r, { ...q, reused: true }, study.plan)));
    }
    study.reuseFrozen = true;
    await io.save(study);
  }
  const blocked = study.journal.some((j) => ['reserved', 'unknown'].includes(j.status));
  if (!blocked) {
    for (const q of study.queries) {
      for (const source of study.plan.sources.filter((s) => s !== 'comments')) {
        const key = `${q.id}:${source}`;
        if (study.journal.some((j) => j.key === key)) continue;
        if (await io.cancelled()) { study.status = 'cancelled'; await io.save(study); return io.publish(personaReport(study, study.evidence), study.evidence); }
        const used = study.journal.length;
        const credits = study.journal.reduce((sum, j) => sum + (j.credits ?? 1), 0);
        const reservedForComments = study.plan.sources.includes('comments') ? Math.min(study.plan.budget.commentVideos, study.plan.budget.requests, study.plan.budget.credits) : 0;
        if (used >= study.plan.budget.requests - reservedForComments || credits + 1 > study.plan.budget.credits - reservedForComments) break;
        const j = { key, stratumId: q.id, query: q.query, source, status: 'reserved', at: new Date().toISOString(), estimatedCredits: 1 };
        study.journal.push(j);
        await io.save(study);
        try {
          const result = await io.collect(source, q, study.plan);
          j.credits = Number.isFinite(result.credits) ? result.credits : null;
          j.status = j.credits === null ? 'unknown' : 'done';
          j.received = result.records.length;
          study.evidence = mergePersonaEvidence(study.evidence, result.records.slice(0, study.plan.budget.perQuery).map((r) => personaEvidence(r, q, study.plan)));
          await io.save(study);
        } catch (error) {
          j.status = 'unknown'; j.message = String(error.message || error).slice(0, 1000);
          await io.save(study);
        }
        if (j.status === 'unknown') break;
      }
      if (study.journal.some((j) => j.status === 'unknown')) break;
    }
    if (study.plan.sources.includes('comments') && !study.journal.some((j) => ['reserved', 'unknown'].includes(j.status))) {
      const videos = new Map();
      // A source page can enter several layers; request it only once.
      for (const q of study.queries) {
        const video = study.evidence.find((r) => r.kind === 'content' && /tiktok\.com\/.+\/video\/\d+/.test(r.sourceUrl) && r.memberships.some((m) => m.stratumId === q.id) && !videos.has(r.sourceUrl));
        if (video) videos.set(video.sourceUrl, { q, video });
      }
      for (const { q, video } of [...videos.values()].slice(0, study.plan.budget.commentVideos)) {
        const key = `comments:${video.sourceUrl}`;
        if (study.journal.some((j) => j.key === key)) continue;
        if (await io.cancelled()) { study.status = 'cancelled'; break; }
        const credits = study.journal.reduce((sum, j) => sum + (j.credits ?? 1), 0);
        if (study.journal.length >= study.plan.budget.requests || credits + 1 > study.plan.budget.credits) break;
        const j = { key, stratumId: q.id, query: q.query, source: 'comments', url: video.sourceUrl, status: 'reserved', at: new Date().toISOString() };
        study.journal.push(j); await io.save(study);
        try {
          const result = await io.collect('comments', { ...q, url: video.sourceUrl }, study.plan);
          j.credits = Number.isFinite(result.credits) ? result.credits : null;
          j.status = j.credits === null ? 'unknown' : 'done'; j.received = result.records.length;
          study.evidence = mergePersonaEvidence(study.evidence, result.records.slice(0, study.plan.budget.perQuery).map((r) => personaEvidence(r, q, study.plan)));
        } catch (error) { j.status = 'unknown'; j.message = String(error.message || error).slice(0, 1000); }
        await io.save(study);
        if (j.status === 'unknown') break;
      }
    }
  }
  if (await io.cancelled()) study.status = 'cancelled';
  if (study.status !== 'cancelled') study.status = 'partial';
  study.finishedAt = new Date().toISOString();
  await io.save(study);
  return io.publish(personaReport(study, study.evidence), study.evidence);
}
