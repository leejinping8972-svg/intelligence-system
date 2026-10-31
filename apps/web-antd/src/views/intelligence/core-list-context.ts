import { reactive } from 'vue';
import { cloudRequest } from './cloud-workspace';
import type { FxRates } from './core-list-metrics';

export const coreListContext = reactive<{ fx?: FxRates }>({});
let loaded = false;
export async function loadCoreRates(refresh = false) {
  if (loaded && !refresh) return;
  loaded = true;
  try {
    const fx = await cloudRequest<FxRates | null>(
      refresh ? 'server_core_rates_refresh' : 'server_core_rates',
      {},
    );
    if (fx) coreListContext.fx = fx;
  } catch (error) {
    if (refresh) throw error;
  }
}
