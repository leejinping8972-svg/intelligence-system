import type { WatchConfig, WatchRun } from './competitor-monitor';

import {
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  reactive,
  watch,
} from 'vue';

import { cloudRequest } from './cloud-workspace';

export const competitorWorkspace = reactive({
  targets: [] as WatchConfig[],
  runs: [] as WatchRun[],
  loading: false,
  error: '',
  loaded: false,
});
let flight: Promise<void> | undefined;
export function refreshCompetitorWorkspace(
  afterMutation = false,
): Promise<void> {
  if (flight)
    return afterMutation
      ? flight.then(() => refreshCompetitorWorkspace())
      : flight;
  competitorWorkspace.loading = true;
  flight = cloudRequest<{ targets: WatchConfig[]; runs: WatchRun[] }>(
    'server_competitor_overview',
  )
    .then((result) => {
      competitorWorkspace.targets = result.targets;
      competitorWorkspace.runs = result.runs;
      competitorWorkspace.loaded = true;
      competitorWorkspace.error = '';
    })
    .catch((error: unknown) => {
      competitorWorkspace.error =
        error instanceof Error ? error.message : '监控读取失败';
    })
    .finally(() => {
      competitorWorkspace.loading = false;
      flight = undefined;
    });
  return flight;
}
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
export function useCompetitorWorkspace(enabled = () => true) {
  let active = false;
  let visible = false;
  function start() {
    if (active || !enabled() || !visible) return;
    active = true;
    consumers++;
    void refreshCompetitorWorkspace();
    timer ||= setInterval(() => void refreshCompetitorWorkspace(), 15_000);
  }
  function stop() {
    if (!active) return;
    active = false;
    consumers--;
    if (consumers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }
  const activate = () => { visible = true; start(); };
  onMounted(activate);
  onActivated(activate);
  onDeactivated(() => { visible = false; stop(); });
  onUnmounted(stop);
  watch(enabled, value => { if (value) start(); else stop(); });
  return competitorWorkspace;
}
