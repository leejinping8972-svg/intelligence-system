import { expect, it, vi } from 'vitest';

import { useConceptSeedSuggestions } from '../apps/web-antd/src/views/intelligence/concept-seed-suggestions';

it('shows configuration guidance when the server cannot suggest without a model', async () => {
  const ai = useConceptSeedSuggestions(async () => ({ configured: false, keywords: [] }));
  expect(await ai.generate('GLP-1 companion', '')).toBeNull();
  expect(ai.needsConfiguration.value).toBe(true);
  expect(ai.noticeType.value).toBe('warning');
  expect(ai.notice.value).toContain('AI 配置');
  expect(ai.busy.value).toBe(false);
});

it('still requests AI suggestions with a task name and no optional description', async () => {
  const suggest = vi.fn(async () => ({ configured: true, keywords: [' protein ', 'creatine', 'protein'] }));
  const ai = useConceptSeedSuggestions(suggest);
  expect(await ai.generate(' GLP-1 companion ', '')).toEqual(['protein', 'creatine']);
  expect(suggest).toHaveBeenCalledWith({ taskName: 'GLP-1 companion', description: '' });
  expect(ai.noticeType.value).toBe('success');
  expect(ai.notice.value).toContain('2 个');
});

it('passes task name and direction constraints together', async () => {
  const suggest = vi.fn(async () => ({ keywords: ['protein'] }));
  await useConceptSeedSuggestions(suggest).generate('GLP-1 companion', ' 只关注胶囊 ');
  expect(suggest).toHaveBeenCalledWith({ taskName: 'GLP-1 companion', description: '只关注胶囊' });
});

it('keeps a named ingredient as the topic when the optional direction is empty', async () => {
  const suggest = vi.fn(async () => ({ keywords: ['GHK-Cu', 'copper tripeptide-1'] }));
  const ai = useConceptSeedSuggestions(suggest);
  expect(await ai.generate('蓝铜肽(GHK-Cu)', '')).toEqual(['GHK-Cu', 'copper tripeptide-1']);
  expect(suggest).toHaveBeenCalledWith({ taskName: '蓝铜肽(GHK-Cu)', description: '' });
});

it('reports an empty result instead of presenting a successful blank input', async () => {
  const ai = useConceptSeedSuggestions(async () => ({ configured: true, keywords: [' '] }));
  expect(await ai.generate('GLP-1 companion', '')).toBeNull();
  expect(ai.noticeType.value).toBe('error');
  expect(ai.notice.value).toContain('未返回有效');
});

it('shows timeouts and only makes another request on manual retry', async () => {
  const suggest = vi.fn().mockRejectedValueOnce(new Error('模型接口超时')).mockResolvedValueOnce({ keywords: ['creatine'] });
  const ai = useConceptSeedSuggestions(suggest);
  expect(await ai.generate('GLP-1 companion', '')).toBeNull();
  expect(ai.notice.value).toBe('模型接口超时');
  expect(suggest).toHaveBeenCalledTimes(1);
  expect(await ai.generate('GLP-1 companion', '')).toEqual(['creatine']);
  expect(ai.noticeType.value).toBe('success');
});

it('clears the configuration warning after the model is saved and manually retried', async () => {
  const suggest = vi.fn().mockResolvedValueOnce({ configured: false }).mockResolvedValueOnce({ configured: true, keywords: ['protein'] });
  const ai = useConceptSeedSuggestions(suggest);
  await ai.generate('GLP-1 companion', '');
  expect(ai.needsConfiguration.value).toBe(true);
  expect(await ai.generate('GLP-1 companion', '')).toEqual(['protein']);
  expect(ai.needsConfiguration.value).toBe(false);
});

it('blocks duplicate requests while generating', async () => {
  let finish!: (value: { keywords: string[] }) => void;
  const suggest = vi.fn(() => new Promise<{ keywords: string[] }>((resolve) => { finish = resolve; }));
  const ai = useConceptSeedSuggestions(suggest);
  const pending = ai.generate('GLP-1 companion', '');
  expect(ai.busy.value).toBe(true);
  expect(await ai.generate('GLP-1 companion', '')).toBeNull();
  finish({ keywords: ['protein'] });
  await pending;
  expect(suggest).toHaveBeenCalledTimes(1);
});

it('ignores results from a closed dialog without resetting a newer request', async () => {
  const complete: Array<(value: { keywords: string[] }) => void> = [];
  const ai = useConceptSeedSuggestions(() => new Promise((resolve) => { complete.push(resolve); }));
  const old = ai.generate('old task', '');
  ai.reset();
  const current = ai.generate('new task', '');
  complete[0]?.({ keywords: ['old result'] });
  expect(await old).toBeNull();
  expect(ai.busy.value).toBe(true);
  expect(ai.notice.value).toBe('');
  complete[1]?.({ keywords: ['new result'] });
  expect(await current).toEqual(['new result']);
  expect(ai.busy.value).toBe(false);
});
