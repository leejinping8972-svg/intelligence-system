import { pool, putDocument, lock, unlock } from './database.mjs';
import { requireAdmin } from './auth.mjs';
import {
  AD_REPORT_PROMPT,
  LEGACY_RESEARCH_PROMPT,
  promptSnapshot,
} from './ad-report-prompt.mjs';
const NAME = 'provider:ad-report-prompt:v1';
export async function currentAdPrompt() {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])
  ).rows[0]?.value;
  return promptSnapshot(stored?.text || AD_REPORT_PROMPT, {
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || '系统默认',
  });
}
export async function reportPromptAction(input, user) {
  if (input.action === 'server_ad_report_prompt_save') {
    requireAdmin(user);
    const text = String(input.text || '').trim();
    if (text.length < 100 || text.length > 12000)
      throw new Error('分析提示词需为100～12000字');
    const c = await pool.connect();
    let held = false;
    try {
      held = await lock(c, 'ad-report-prompt-save');
      if (!held) throw new Error('其他管理员正在保存，请稍后重试');
      const old = await currentAdPrompt();
      if (input.version !== old.version)
        throw new Error('提示词已被更新，请重新读取后再修改');
      await putDocument('provider_configs', NAME, {
        text,
        updatedAt: new Date().toISOString(),
        updatedBy: user.displayName || user.username || '管理员',
      });
    } finally {
      if (held) await unlock(c, 'ad-report-prompt-save');
      c.release();
    }
  }
  return {
    ...(await currentAdPrompt()),
    defaultText: AD_REPORT_PROMPT,
    legacyText: LEGACY_RESEARCH_PROMPT,
  };
}
