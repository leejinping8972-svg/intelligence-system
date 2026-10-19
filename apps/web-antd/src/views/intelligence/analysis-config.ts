type Sender = (
  action: string,
  input?: Record<string, unknown>,
) => Promise<{ configured?: boolean; lastSaveId?: string }>;
export async function persistAnalysisConfig(
  input: Record<string, unknown>,
  send: Sender,
  requestId: string,
) {
  try {
    await send('server_analysis_config', { ...input, requestId });
  } catch (error) {
    // A lost response does not prove the encrypted write failed. Confirm this exact
    // save ID; matching model names alone must never confirm a changed secret.
    try {
      const status = await send('server_analysis_status');
      if (status.configured && status.lastSaveId === requestId) return;
    } catch {}
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        ['AbortError', 'TimeoutError'].includes(error.name))
    )
      throw new Error(
        '与后台连接中断，尚未确认保存成功；填写内容已保留，请恢复连接后重试。',
      );
    throw error;
  }
}
