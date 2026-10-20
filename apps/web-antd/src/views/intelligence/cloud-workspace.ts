import type { Keyword, Task } from './data';
import type { KeywordResearchInput } from './keyword-research';

import { reactive, ref, watch } from 'vue';

import { state } from './data';
import { RequestFlight } from './request-flight';
import { adminRequest, leaveSession, serverMode, session } from './session';
import { isWorkspaceSyncKey } from './workspace-sync-keys';

export const cloudWorkspace = reactive({
  ready: false,
  syncing: false,
  submitting: false,
  error: '',
  lastSynced: '',
  active: 0,
  taskRevision: '',
});
const known = new Map<string, string>();
const pending = new Map<string, Record<string, unknown>>();
const businessKnown = new Map<string, string>();
const businessPending = new Map<string, unknown>();
const collections = [
  'sites',
  'products',
  'ads',
  'reviews',
  'monitors',
  'imports',
  'audit',
] as const;
function businessEntries() {
  const entries = new Map<string, unknown>();
  for (const collection of collections)
    for (const item of state[collection]) {
      const record = item as unknown as Record<string, unknown>;
      if (record.dataNature === 'demo') continue;
      const id = record.id || record.productId;
      if (id) entries.set(`${collection}:${id}`, item);
    }
  for (const task of state.tasks)
    if (!task.cloudJobId && task.mode !== 'demo')
      entries.set(`legacyTasks:${task.id}`, task);
  if (!serverMode || session.user?.role === 'admin') {
    entries.set('branding:main', state.branding);
    entries.set(
      'preferences:main',
      Object.fromEntries(
        Object.entries(state.settings).filter(
          ([key]) => !['researchAccessKey', 'researchApiUrl'].includes(key),
        ),
      ),
    );
  }
  return entries;
}
const applying = ref(false);
let revisions: Record<string, string> = {};
const syncFlight = new RequestFlight<void>();
const submissionFlights = new Map<string, Promise<ResearchSubmission>>();
interface ResearchSubmission {
  jobId: string;
  tasks: Task[];
  acceptedKeywords?: number;
  reused?: boolean;
}
let clearing = false;
let initialized = '';
let pendingSubmission: undefined | { signature: string; requestId: string };
watch(
  () =>
    applying.value
      ? null
      : [...businessEntries()].map(([key, value]) => ({
          key,
          value: JSON.stringify(value),
        })),
  (entries) => {
    if (!entries || applying.value || !cloudWorkspace.ready) return;
    const current = new Map(entries.map((entry) => [entry.key, entry.value]));
    for (const { key, value } of entries)
      if (businessKnown.get(key) !== value)
        businessPending.set(key, JSON.parse(value));
    for (const key of businessKnown.keys())
      if (
        isWorkspaceSyncKey(key) &&
        !current.has(key) &&
        (!serverMode ||
          session.user?.role === 'admin' ||
          !/^(branding|preferences):/.test(key))
      )
        businessPending.set(key, null);
  },
  { deep: true, flush: 'sync' },
);
const editable = (record: Keyword) => ({
  favorite: record.favorite,
  reviewStatus: record.reviewStatus || 'pending',
  reviewNote: record.reviewNote || '',
  metrics: record.metrics || null,
});
export async function cloudRequest<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  if (serverMode) return adminRequest<T>(action, input);
  const { researchApiUrl, researchAccessKey } = state.settings;
  if (!researchApiUrl || !researchAccessKey)
    throw new Error('请先配置研究服务地址和访问码');
  if (new URL(researchApiUrl).protocol !== 'https:')
    throw new Error('云端业务服务需通过HTTPS访问');
  const response = await fetch(researchApiUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-research-key': researchAccessKey,
    },
    body: JSON.stringify({ ...input, action }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (serverMode && response.status === 401) leaveSession();
    throw new Error(result.error || `云端业务服务HTTP ${response.status}`);
  }
  return result as T;
}
watch(
  () =>
    applying.value
      ? null
      : state.keywords.map((record) => ({
          id: record.id,
          patch: editable(record),
        })),
  (values) => {
    if (!values || applying.value) return;
    for (const { id, patch } of values)
      if (known.has(id) && known.get(id) !== JSON.stringify(patch))
        pending.set(id, patch);
  },
  { deep: true, flush: 'sync' },
);
export function syncCloudWorkspace() {
  return syncFlight.run(runCloudSync);
}
async function runCloudSync() {
  if (
    cloudWorkspace.syncing ||
    clearing ||
    (!serverMode &&
      (!state.settings.researchAccessKey || !state.settings.researchApiUrl))
  )
    return;
  cloudWorkspace.syncing = true;
  try {
    const scope = serverMode
      ? `server:${session.user?.id || ''}`
      : `${state.settings.researchApiUrl}|${state.settings.researchAccessKey}`;
    if (initialized !== scope) {
      await cloudRequest('server_status');
      let clientId = localStorage.getItem('intelligence-cloud-client-id');
      if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem('intelligence-cloud-client-id', clientId);
      }
      const local = state.keywords.filter(
        (record) => record.dataNature !== 'demo',
      );
      if (!serverMode && local.length > 1000)
        throw new Error('本机超过1000个关键词，请先导出备份并分批迁移');
      const migration = serverMode
        ? { initialized: false }
        : await cloudRequest<{ initialized: boolean }>(
            'server_import_keywords',
            {
              clientId,
              keywords: local,
            },
          );
      const entries = [...businessEntries()].map(([key, value]) => ({
        key,
        value,
      }));
      for (
        let index = 0;
        migration.initialized && index < entries.length;
        index += 1000
      )
        await cloudRequest('server_workspace_sync', {
          entries: entries.slice(index, index + 1000),
          importOnly: true,
        });
      initialized = scope;
      revisions = {};
    }
    if (pending.size > 0) {
      const updates = [...pending]
        .slice(0, 100)
        .map(([id, patch]) => ({ id, patch }));
      await cloudRequest('server_patch_keywords', { updates });
      for (const { id, patch } of updates) {
        known.set(id, JSON.stringify(patch));
        if (JSON.stringify(pending.get(id)) === JSON.stringify(patch))
          pending.delete(id);
      }
    }
    if (businessPending.size > 0) {
      const entries = [...businessPending]
        .slice(0, 1000)
        .map(([key, value]) => ({ key, value }));
      await cloudRequest('server_workspace_sync', { entries });
      for (const { key, value } of entries) {
        if (JSON.stringify(businessPending.get(key)) === JSON.stringify(value))
          businessPending.delete(key);
        if (value === null) businessKnown.delete(key);
        else businessKnown.set(key, JSON.stringify(value));
      }
    }
    const snapshot = serverMode
      ? await cloudRequest<{
          business?: { entries: Array<{ key: string; value: unknown }> };
          keywords?: Keyword[];
          tasks?: Task[];
          revisions: Record<string, string>;
          generatedAt: string;
        }>('server_workspace_delta', { revisions })
      : await Promise.all([
          cloudRequest<{ entries: Array<{ key: string; value: unknown }> }>(
            'server_workspace_snapshot',
          ),
          cloudRequest<{
            keywords: Keyword[];
            tasks: Task[];
            generatedAt: string;
          }>('server_snapshot'),
        ]).then(([business, snapshot]) => ({
          ...snapshot,
          business,
          revisions: {} as Record<string, string>,
        }));
    const business = snapshot.business;
    applying.value = true;

    try {
      if (business) {
        const entries = new Map(
          business.entries
            .filter(({ key }) => isWorkspaceSyncKey(key))
            .map(({ key, value }) => [key, value]),
        );
        businessKnown.clear();
        for (const [key, value] of entries)
          if (
            !serverMode ||
            session.user?.role === 'admin' ||
            !/^(branding|preferences):/.test(key)
          )
            businessKnown.set(key, JSON.stringify(value));
        for (const [key, value] of businessPending) {
          if (value === null) entries.delete(key);
          else entries.set(key, value);
        }
        for (const collection of collections) {
          const values = [...entries]
            .filter(([key]) => key.startsWith(`${collection}:`))
            .map(([, value]) => value);
          (state[collection] as unknown[]).splice(
            0,
            state[collection].length,
            ...values,
          );
        }
        for (const [key, value] of entries)
          if (key.startsWith('legacyTasks:')) {
            const task = value as Task;
            const current = state.tasks.find((item) => item.id === task.id);
            if (current) Object.assign(current, task);
            else state.tasks.push(task);
          }
        if (entries.has('branding:main'))
          Object.assign(state.branding, entries.get('branding:main'));
        if (serverMode && state.branding.logo === '/hci-logo.svg')
          state.branding.logo = `${import.meta.env.BASE_URL}hci-logo.svg`;
        if (entries.has('preferences:main'))
          Object.assign(state.settings, entries.get('preferences:main'));
      }
      if (snapshot.keywords) {
        const currentKeywords = new Map(
          state.keywords.map((record) => [record.id, record]),
        );
        const next = snapshot.keywords.map((record) => {
          const local = currentKeywords.get(record.id);
          const merged = {
            ...record,
            ...pending.get(record.id),
          } as Keyword;
          known.set(record.id, JSON.stringify(editable(record)));
          if (local) {
            Object.assign(local, merged);
            return local;
          }
          return merged;
        });
        state.keywords.splice(0, state.keywords.length, ...next);
      }
      if (snapshot.tasks) {
        cloudWorkspace.taskRevision =
          snapshot.revisions.tasks || snapshot.generatedAt;
        const currentTasks = new Map(
          state.tasks.map((task) => [task.id, task]),
        );
        for (const task of snapshot.tasks) {
          const current = currentTasks.get(task.id);
          if (current) Object.assign(current, task);
          else state.tasks.unshift(task);
        }
        const taskIds = new Set(snapshot.tasks.map((task) => task.id));
        state.tasks = state.tasks.filter(
          (task) => !task.cloudJobId || taskIds.has(task.id),
        );
      }
      revisions = snapshot.revisions;
    } finally {
      applying.value = false;
    }
    cloudWorkspace.active = new Set(
      state.tasks
        .filter(
          (task) =>
            task.cloudJobId && ['queued', 'running'].includes(task.status),
        )
        .map((task) => task.cloudJobId),
    ).size;
    cloudWorkspace.ready = true;
    cloudWorkspace.error = '';
    cloudWorkspace.lastSynced = snapshot.generatedAt;
  } catch (error) {
    cloudWorkspace.error =
      error instanceof Error ? error.message : '云端同步失败';
    throw error;
  } finally {
    cloudWorkspace.syncing = false;
  }
}
export function submitCloudResearch(
  input: Omit<KeywordResearchInput, 'signal'>,
  existingRecords?: Keyword[],
) {
  const key = JSON.stringify({ input, existingRecords });
  const pending = submissionFlights.get(key);
  if (pending) return pending;
  if (cloudWorkspace.submitting)
    return Promise.reject(new Error('正在提交另一项任务，请稍后再试'));
  const result = doSubmitCloudResearch(input, existingRecords);
  submissionFlights.set(key, result);
  void result.finally(() => submissionFlights.delete(key)).catch(() => {});
  return result;
}
async function doSubmitCloudResearch(
  input: Omit<KeywordResearchInput, 'signal'>,
  existingRecords?: Keyword[],
) {
  const payload = {
    seeds: input.seeds,
    markets: input.markets,
    sources: input.sources,
    depth: input.depth,
    limit: input.limit,
    ...(existingRecords
      ? {
          expectedKeywordCount:
            input.expectedKeywordCount ?? existingRecords.length,
        }
      : {}),
    sorftimeRequestLimit: input.sorftimeRequestLimit,
    ...(existingRecords ? { existingRecords } : {}),
  };
  const signature = JSON.stringify(payload);
  if (pendingSubmission?.signature !== signature)
    pendingSubmission = { signature, requestId: crypto.randomUUID() };
  cloudWorkspace.submitting = true;
  try {
    const result = await cloudRequest<ResearchSubmission>('server_submit', {
      input: payload,
      requestId: pendingSubmission.requestId,
    });
    if (
      existingRecords &&
      result.acceptedKeywords !== undefined &&
      result.acceptedKeywords !== payload.expectedKeywordCount
    )
      throw new Error(
        `后台接收数量${result.acceptedKeywords}与勾选数量${payload.expectedKeywordCount}不一致。请勿重复提交，任务编号：${result.jobId}`,
      );
    pendingSubmission = undefined;
    for (const task of result.tasks)
      if (!state.tasks.some((item) => item.id === task.id))
        state.tasks.unshift(task);
    cloudWorkspace.ready = true;
    cloudWorkspace.active = new Set(
      state.tasks
        .filter(
          (task) =>
            task.cloudJobId && ['queued', 'running'].includes(task.status),
        )
        .map((task) => task.cloudJobId),
    ).size;
    cloudWorkspace.error = '';
    void syncCloudWorkspace().catch(() => {});
    return result;
  } finally {
    cloudWorkspace.submitting = false;
  }
}
export async function cancelCloudJob(jobId: string) {
  await cloudRequest('server_cancel', { jobId });
  await syncCloudWorkspace();
}
let enrichmentRequest: undefined | { signature: string; requestId: string };
export async function submitCloudEnrichment(
  kind: 'metrics' | 'sites',
  keywordIds: string[],
  maxSites = 10,
) {
  while (cloudWorkspace.syncing)
    await new Promise((resolve) => setTimeout(resolve, 100));
  await syncCloudWorkspace();
  if (cloudWorkspace.error) throw new Error(cloudWorkspace.error);
  const signature = JSON.stringify({
    kind,
    keywordIds: keywordIds.toSorted(),
    maxSites,
  });
  if (enrichmentRequest?.signature !== signature)
    enrichmentRequest = { signature, requestId: crypto.randomUUID() };
  const result = await cloudRequest<{ jobId: string; tasks: Task[] }>(
    'server_submit_enrichment',
    { kind, keywordIds, maxSites, requestId: enrichmentRequest.requestId },
  );
  enrichmentRequest = undefined;
  for (const task of result.tasks)
    if (!state.tasks.some((t) => t.id === task.id)) state.tasks.unshift(task);
  await syncCloudWorkspace();
  return result;
}
export async function retryCloudTrends(jobId: string) {
  const result = await cloudRequest<{ jobId: string; tasks: Task[] }>(
    'server_retry_trends',
    { jobId, requestId: crypto.randomUUID() },
  );
  await syncCloudWorkspace();
  return result;
}
export async function clearCloudKeywords() {
  clearing = true;
  try {
    while (cloudWorkspace.syncing)
      await new Promise((resolve) => setTimeout(resolve, 100));
    await cloudRequest('server_clear_keywords', {
      confirm: 'clear-keyword-results',
    });
    known.clear();
    pending.clear();
    businessKnown.clear();
    businessPending.clear();
  } finally {
    clearing = false;
  }
}
let lastPoll = 0;
let timer: ReturnType<typeof setInterval> | undefined;
export function startCloudSync() {
  if (timer) return;
  void syncCloudWorkspace().catch(() => {});
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    const idle =
      cloudWorkspace.active === 0 &&
      pending.size === 0 &&
      businessPending.size === 0;
    if (idle && Date.now() - lastPoll < 30_000) return;
    lastPoll = Date.now();
    void syncCloudWorkspace().catch(() => {});
  }, 5000);
}
export function stopCloudSync() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
