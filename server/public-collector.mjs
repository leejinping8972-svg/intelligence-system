// Invoked by the daily collector. Only public observations are written to stdout.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from './database.mjs';
import { readYoutubeKey } from './youtube-config.mjs';

const directory = await mkdtemp(join(tmpdir(), 'public-observations-'));
try {
  const key = await readYoutubeKey();
  const output = join(directory, 'observations.json');
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL('./public-sources/collect-free-sources.mjs', import.meta.url)
          .pathname,
      ],
      {
        env: {
          ...process.env,
          YOUTUBE_API_KEY: key,
          HCI_FREE_SOURCE_OUTPUT: output,
          HCI_FREE_SOURCES_PREVIOUS_URL:
            'https://is.luckdate.com/admin/data/free-source-observations.json',
        },
        // The collector logs only public source counts to stderr, not credentials.
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 1_000_000,
      },
    );
    child.stderr.resume();
    child.on('error', () => reject(new Error('公共情报采集进程启动失败')));
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('公共情报采集未完成，原数据已保留')),
    );
  });
  const text = await readFile(output, 'utf8');
  const result = JSON.parse(text);
  if (!Array.isArray(result.sourceRuns) || !Array.isArray(result.signals))
    throw new Error('公共情报结果格式不正确');
  process.stdout.write(text);
} catch {
  process.stderr.write('公共情报采集失败，未替换历史结果\n');
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
  await pool.end();
}
