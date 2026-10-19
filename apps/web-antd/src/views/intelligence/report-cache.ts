import type { ResearchEvidence, ResearchReport } from './research-reports';

export interface ReportDetails {
  report: ResearchReport;
  evidence: ResearchEvidence[];
}

const version = (report: ResearchReport) =>
  report.revision === undefined
    ? JSON.stringify([
        report.status,
        report.finishedAt,
        report.reviewStatus,
        report.evidenceIds,
      ])
    : String(report.revision);

// Bounded, account-scoped memory: route changes reuse evidence without persisting
// private research content to browser storage.
export class ReportCache {
  private scope = '';
  private saved = new Map<string, ReportDetails>();
  private pending = new Map<
    string,
    { version: string; request: Promise<ReportDetails> }
  >();

  private selectScope(scope: string) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.saved.clear();
      this.pending.clear();
    }
  }
  peek(scope: string, id: string) {
    this.selectScope(scope);
    return this.saved.get(id);
  }
  save(scope: string, data: ReportDetails) {
    this.selectScope(scope);
    this.pending.delete(data.report.id);
    this.remember(data);
  }
  private remember(data: ReportDetails) {
    this.saved.delete(data.report.id);
    this.saved.set(data.report.id, data);
    while (this.saved.size > 20)
      this.saved.delete(this.saved.keys().next().value!);
  }
  read(
    scope: string,
    report: ResearchReport,
    fetchDetails: () => Promise<ReportDetails>,
    force = false,
  ): Promise<ReportDetails> {
    this.selectScope(scope);
    const cached = this.saved.get(report.id);
    const wanted = version(report);
    if (
      !force &&
      cached &&
      version(cached.report) === wanted &&
      !['queued', 'running'].includes(report.status)
    ) {
      this.remember(cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(report.id);
    if (pending?.version === wanted) return pending.request;
    const entry = {
      version: wanted,
      request: Promise.resolve()
        .then(fetchDetails)
        .then((data) => {
          if (this.scope === scope && this.pending.get(report.id) === entry)
            this.remember(data);
          return data;
        })
        .finally(() => {
          if (this.pending.get(report.id) === entry)
            this.pending.delete(report.id);
        }),
    };
    this.pending.set(report.id, entry);
    return entry.request;
  }
}
