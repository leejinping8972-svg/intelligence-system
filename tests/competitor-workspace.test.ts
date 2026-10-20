import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('../apps/web-antd/src/views/intelligence/cloud-workspace', () => ({
  cloudRequest: request,
}));
import {
  competitorWorkspace,
  refreshCompetitorWorkspace,
} from '../apps/web-antd/src/views/intelligence/competitor-workspace';
describe('monitor workspace refresh', () => {
  beforeEach(() => {
    request.mockReset();
    competitorWorkspace.targets = [];
    competitorWorkspace.runs = [];
    competitorWorkspace.error = '';
  });
  it('coalesces reads but performs a new read after a mutation and an old in-flight snapshot', async () => {
    let resolveOld!: (value: unknown) => void,
      resolveNew!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const old = refreshCompetitorWorkspace();
    expect(refreshCompetitorWorkspace()).toBe(old);
    const fresh = refreshCompetitorWorkspace(true);
    expect(request).toHaveBeenCalledTimes(1);
    resolveOld({ targets: [{ id: 'old' }], runs: [] });
    await old;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    resolveNew({ targets: [{ id: 'new' }], runs: [] });
    await fresh;
    expect(competitorWorkspace.targets.map((t) => t.id)).toEqual(['new']);
  });
  it('retains loaded monitors when a read fails and exposes the error', async () => {
    request.mockResolvedValueOnce({ targets: [{ id: 'keep' }], runs: [] });
    await refreshCompetitorWorkspace();
    request.mockRejectedValueOnce(new Error('synthetic offline'));
    await refreshCompetitorWorkspace();
    expect(competitorWorkspace.targets.map((t) => t.id)).toEqual(['keep']);
    expect(competitorWorkspace.error).toBe('synthetic offline');
    expect(competitorWorkspace.loading).toBe(false);
  });
});
