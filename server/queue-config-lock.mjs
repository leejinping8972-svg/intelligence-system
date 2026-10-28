import { setTimeout as sleep } from 'node:timers/promises';

import { lock, pool, unlock } from './database.mjs';
export async function withQueueConfig(name, callback, connection) {
  const c = connection || (await pool.connect());
  let held = false;
  try {
    for (let attempt = 0; attempt < 100 && !held; attempt++) {
      held = await lock(c, name);
      if (!held) await sleep(25);
    }
    if (!held) throw new Error('配置提交繁忙，请稍后再试；后台任务不影响保存');
    return await callback(c);
  } finally {
    try {
      if (held) await unlock(c, name);
    } finally {
      if (!connection) c.release();
    }
  }
}
