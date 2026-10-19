import { readFile } from 'node:fs/promises';
import { pool, putDocument } from './database.mjs';
import { requireAdmin } from './auth.mjs';
let current = '';
export async function registerRelease(
  io = {
    read: () =>
      readFile(new URL('./release-manifest.json', import.meta.url), 'utf8'),
    write: (name, v) => putDocument('workspace_documents', name, v, true),
  },
) {
  let manifest;
  try {
    manifest = JSON.parse(await io.read());
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (
    !/^[a-zA-Z0-9._-]{1,80}$/.test(manifest.id) ||
    !Array.isArray(manifest.changes) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('发布清单格式不正确');
  current = manifest.id;
  await io.write(`system:release:${manifest.id}`, {
    ...manifest,
    startedAt: new Date().toISOString(),
  });
}
export async function releaseHistory(user) {
  requireAdmin(user);
  const { rows } = await pool.query(
    "SELECT value FROM workspace_documents WHERE name LIKE 'system:release:%' ORDER BY name DESC LIMIT 200",
  );
  return {
    current,
    entries: rows.map((r) => ({ ...r.value, current: r.value.id === current })),
    limit: 200,
  };
}
