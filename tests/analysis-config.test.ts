import { describe, expect, it, vi } from 'vitest';
import { persistAnalysisConfig } from '../apps/web-antd/src/views/intelligence/analysis-config';

describe('encrypted model configuration save confirmation', () => {
  it('confirms a committed write after its response is lost without resubmitting', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ configured: true, lastSaveId: 'save-a' });
    await expect(
      persistAnalysisConfig({ apiKey: 'qa-only' }, send, 'save-a'),
    ).resolves.toBeUndefined();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      'server_analysis_config',
      'server_analysis_status',
    ]);
  });
  it('never confirms an older save when a changed key was not saved', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ configured: true, lastSaveId: 'save-old' });
    const form = { apiKey: 'qa-only-new' };
    await expect(persistAnalysisConfig(form, send, 'save-new')).rejects.toThrow(
      /尚未确认保存成功/,
    );
    expect(form.apiKey).toBe('qa-only-new');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('retains validation errors and reports interrupted status checks without retrying the write', async () => {
    const error = new Error('请检查模型名');
    const send = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ configured: false });
    await expect(persistAnalysisConfig({}, send, 'save-a')).rejects.toBe(error);
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(persistAnalysisConfig({}, offline, 'save-a')).rejects.toThrow(
      /填写内容已保留/,
    );
    expect(offline).toHaveBeenCalledTimes(2);
  });
});
