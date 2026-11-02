import { watch } from 'vue';
import { cloudRequest } from './cloud-workspace';
import { state } from './data';
import { session, serverMode } from './session';
import { ReportCache, type ReportDetails } from './report-cache';
import type { ResearchReport } from './research-reports';

const cache = new ReportCache();
const scope = () =>
  serverMode
    ? `server:${session.user?.id || 'anonymous'}`
    : `worker:${state.settings.researchApiUrl}:${state.settings.researchAccessKey}`;
watch(scope, (value) => cache.peek(value, ''), { flush: 'sync' });
export const cachedReport = (id: string) => cache.peek(scope(), id);
export const saveReport = (data: ReportDetails) => cache.save(scope(), data);
export function readReport(report: ResearchReport, force = false) {
  return cache.read(
    scope(),
    report,
    () =>
      cloudRequest<ReportDetails>('server_insight_details', {
        reportId: report.id,
      }),
    force,
  );
}
