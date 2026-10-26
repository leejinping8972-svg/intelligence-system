import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../apps/web-antd/src/views/intelligence/cloud-workspace', () => ({ cloudRequest: mocks.request }));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({ session: { user: { id: 'qa' } } }));
beforeEach(() => { vi.resetModules(); mocks.request.mockReset(); });
describe('social trend page cache', () => {
  it('preserves other pages when requests complete out of order and deduplicates the same request', async () => {
    const { loadSocialTrends, socialTrends } = await import('../apps/web-antd/src/views/intelligence/keyword-social-trends');
    let resolveA!: (v: any) => void, resolveB!: (v: any) => void;
    mocks.request.mockImplementationOnce(() => new Promise((r) => { resolveA = r; })).mockImplementationOnce(() => new Promise((r) => { resolveB = r; }));
    const a = loadSocialTrends(['a']);
    expect(loadSocialTrends(['a'])).toBe(a);
    const b = loadSocialTrends(['b']);
    resolveB({ summaries: [{ keywordId: 'b' }] }); await b;
    resolveA({ summaries: [{ keywordId: 'a' }] }); await a;
    expect(socialTrends.summaries.map((s) => s.keywordId).sort()).toEqual(['a', 'b']);
    expect(socialTrends.loadingIds).toEqual([]);
    expect(socialTrends.loading).toBe(false);
  });
  it('keeps values on read failure and clears an absent saved summary only for the refreshed page', async () => {
    const { loadSocialTrends, socialTrends } = await import('../apps/web-antd/src/views/intelligence/keyword-social-trends');
    socialTrends.summaries = [{ keywordId: 'a' }, { keywordId: 'b' }] as any;
    mocks.request.mockRejectedValueOnce(new Error('read failed'));
    await expect(loadSocialTrends(['a'])).rejects.toThrow('read failed');
    expect(socialTrends.summaries).toHaveLength(2);
    expect(socialTrends.errors.a).toBe('read failed');
    mocks.request.mockResolvedValueOnce({ summaries: [] }); await loadSocialTrends(['a']);
    expect(socialTrends.summaries.map((s) => s.keywordId)).toEqual(['b']);
    expect(socialTrends.errors.a).toBeUndefined();
  });
});
