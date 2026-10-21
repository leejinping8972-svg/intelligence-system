import { pool, putDocument, lock, unlock } from './database.mjs';
import { requireAdmin } from './auth.mjs';
import { currentAdPrompt, reportPromptAction } from './report-prompts.mjs';
import { AI_PROMPTS, aiPromptSnapshot } from './ai-prompt-defaults.mjs';

export async function currentAiPrompt(key) {
  if (key === 'ad_report') return { key, ...(await currentAdPrompt()) };
  if (!Object.hasOwn(AI_PROMPTS, key)) throw new Error('未知AI提示词类型');
  const result = await pool.query(
    'SELECT value FROM provider_configs WHERE name=$1',
    [`provider:ai-prompt:${key}:v1`],
  );
  return aiPromptSnapshot(key, result.rows[0]?.value);
}
export async function aiPromptAction(input, user, overrides = {}) {
  requireAdmin(user);
  const io = {
    current: currentAiPrompt,
    put: putDocument,
    connect: () => pool.connect(),
    lock,
    unlock,
    ...overrides,
  };
  if (input.action === 'server_ai_prompt_save') {
    if (!Object.hasOwn(AI_PROMPTS, input.key))
      throw new Error('未知AI提示词类型');
    const text = String(input.text || '').trim();
    if (text.length < 20 || text.length > 12_000)
      throw new Error('提示词需为20～12000字');
    if (input.key === 'ad_report') {
      return reportPromptAction(
        { ...input, action: 'server_ad_report_prompt_save' },
        user,
      );
    }
    const c = await io.connect();
    let held = false;
    try {
      held = await io.lock(c, 'ai-prompt-save');
      if (!held) throw new Error('其他管理员正在保存，请稍后重试');
      const current = await io.current(input.key);
      if (input.version !== current.version)
        throw new Error('提示词已更新，请重新读取后修改');
      await io.put('provider_configs', `provider:ai-prompt:${input.key}:v1`, {
        text,
        updatedAt: new Date().toISOString(),
        updatedBy: user.displayName || user.username,
      });
    } finally {
      if (held) await io.unlock(c, 'ai-prompt-save');
      c.release();
    }
  }
  return {
    prompts: await Promise.all(
      Object.entries(AI_PROMPTS).map(async ([key, spec]) => ({
        ...spec,
        defaultText: spec.text,
        ...(await io.current(key)),
      })),
    ),
  };
}
