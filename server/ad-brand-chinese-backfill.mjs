import { readFile, open } from 'node:fs/promises';
import { pool } from './database.mjs';
import { openAdsKey } from './ads-provider.mjs';
import { postModel } from './model-provider.mjs';
import { digest, makeBatches, parseTranslations } from './ad-translation-backfill-domain.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const JOURNAL_PATH = process.argv.includes('--late') ? '/data/ad-brand-chinese-backfill-late-20261104.jsonl' : '/data/ad-brand-chinese-backfill-20261104.jsonl';
const ads = async () => (await pool.query("SELECT name,value,revision FROM workspace_documents WHERE name LIKE 'business:ads:%' ORDER BY name")).rows;
const needsChinese = (value) => String(value.brandZh || '').trim() && !/\p{Script=Han}/u.test(value.brandZh);

async function main() {
  const stored = (await pool.query("SELECT value FROM provider_configs WHERE name='provider:analysis:v1'")).rows[0]?.value;
  if (!stored) throw new Error('未配置模型');
  const config = JSON.parse(openAdsKey(stored));
  const live = await ads();
  const snapshot = live.filter(({ value }) => needsChinese(value)).map(({ name, value }) => ({ name, brand: value.brand, brandZh: value.brandZh }));
  const unique = [...new Set(snapshot.map((row) => row.brand))].map((text) => ({ id: digest(text), field: 'brand', text }));
  const initialBatches = makeBatches(unique, 1000, 12);
  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify({ ads: snapshot.length, unique: unique.length, batches: initialBatches.length, model: config.model }));
    return;
  }
  const journal = await open(JOURNAL_PATH, 'a+', 0o600);
  const append = async (event) => { await journal.appendFile(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`); await journal.sync(); };
  try {
    const content = await readFile(JOURNAL_PATH, 'utf8');
    const events = content.trim() ? content.trim().split('\n').map((line) => JSON.parse(line)) : [];
    const rows = events.length ? events[0].rows : snapshot;
    if (events.length && (events[0].type !== 'header' || events[0].model !== config.model)) throw new Error('品牌检查点与当前模型不符');
    const items = [...new Set(rows.map((row) => row.brand))].map((text) => ({ id: digest(text), field: 'brand', text }));
    const batches = makeBatches(items, 1000, 12);
    const batchIds = batches.map((batch) => digest(batch.map((item) => item.id).join('|')));
    if (events.length && JSON.stringify(events[0].batchIds) !== JSON.stringify(batchIds)) throw new Error('品牌批次检查点不符');
    if (!events.length) await append({ type: 'header', model: config.model, rows, batchIds });
    const translations = new Map();
    const attempts = new Map();
    const completed = new Set();
    for (const event of events.slice(1)) {
      if (event.type === 'started') attempts.set(event.id, Math.max(attempts.get(event.id) || 0, event.attempt));
      if (event.type === 'completed') {
        completed.add(event.id);
        for (const [key, value] of Object.entries(event.translations)) translations.set(key, value);
      }
    }
    console.log(JSON.stringify({ phase: 'brand-plan', ads: rows.length, unique: items.length, batches: batches.length, completed: completed.size }));
    for (let index = 0; index < batches.length; index++) {
      const id = batchIds[index];
      if (completed.has(id)) continue;
      let attempt = (attempts.get(id) || 0) + 1;
      if (attempt > 2) throw new Error(`品牌批次 ${index + 1} 已达到两次尝试上限`);
      const batch = batches[index];
      const request = batch.map((item, position) => ({ id: String(position + 1), field: 'brand', text: item.text }));
      while (attempt <= 2) {
        if (attempt > 1) {
          console.log(JSON.stringify({ phase: 'brand-cooldown', index: index + 1, seconds: 60 }));
          await delay(60_000);
        }
        await append({ type: 'started', id, index, attempt });
        console.log(JSON.stringify({ phase: 'brand-start', index: index + 1, total: batches.length, attempt }));
        try {
          const result = await postModel(config, [
            { role: 'system', content: '为每个外文广告主名称制作简体中文展示名。纯英文名称不得原样返回；没有可靠官方中文名时，用自然的中文音译或准确意译，不冒充官方译名。描述性词语、品类和地域必须翻译。每一项至少包含一个汉字，尽量以汉字开头；原名会由另一字段保留。不要添加功效或资质。只返回 JSON {"translations":[{"id":"输入编号","text":"中文展示名"}]}，逐项完整返回。示例：Zeriva -> 泽瑞瓦；Blue Coast Health -> 蓝岸健康。' },
            { role: 'user', content: JSON.stringify({ translations: request }) },
          ]);
          const response = parseTranslations(result, request);
          const values = Object.fromEntries(batch.map((item, position) => [item.id, response[String(position + 1)].normalize('NFKC').replace(/\s+/g, ' ').trim()]));
          const invalid = Object.entries(values).filter(([, value]) => !/\p{Script=Han}/u.test(value) || value.length > 160).map(([key]) => key);
          await append({ type: 'completed', id, index, attempt, usage: result.usage || null, translations: values, invalid });
          for (const [key, value] of Object.entries(values)) translations.set(key, value);
          console.log(JSON.stringify({ phase: 'brand-done', index: index + 1, total: batches.length, invalid: invalid.length, usage: result.usage || null }));
          break;
        } catch (error) {
          await append({ type: 'failed', id, index, attempt, message: String(error.message).slice(0, 300), possibleCharge: true });
          if (attempt === 2) throw error;
          attempt++;
        }
      }
    }
    let updated = 0;
    const conflicts = [];
    for (const row of rows) {
      const translated = translations.get(digest(row.brand));
      if (!translated) throw new Error(`品牌译文缺失: ${row.name}`);
      if (!/\p{Script=Han}/u.test(translated) || translated.length > 160) continue;
      let current = (await pool.query('SELECT name,value,revision FROM workspace_documents WHERE name=$1', [row.name])).rows[0];
      let done = false;
      for (let attempt = 0; attempt < 3 && current; attempt++) {
        if (current.value.brand !== row.brand || current.value.brandZh !== row.brandZh) break;
        const result = await pool.query('UPDATE workspace_documents SET value=$1,revision=revision+1 WHERE name=$2 AND revision=$3', [{ ...current.value, brandZh: translated }, row.name, current.revision]);
        if (result.rowCount === 1) { updated++; done = true; break; }
        current = (await pool.query('SELECT name,value,revision FROM workspace_documents WHERE name=$1', [row.name])).rows[0];
      }
      if (!done && current?.value.brandZh !== translated) conflicts.push(row.name);
      if (updated % 25 === 0 && done) console.log(JSON.stringify({ phase: 'brand-write', updated, conflicts: conflicts.length }));
    }
    const receipt = { phase: 'brand-finished', updated, conflicts, remaining: (await ads()).filter(({ value }) => needsChinese(value)).length };
    await append(receipt);
    console.log(JSON.stringify(receipt));
    if (conflicts.length || receipt.remaining) process.exitCode = 2;
  } finally { await journal.close(); }
}

try { await main(); } finally { await pool.end(); }
