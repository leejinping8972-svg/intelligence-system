import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Run from the source root before packaging/deployment. No credentials are read.
const root = resolve(import.meta.dirname, '../..');
const description = JSON.parse(
  await readFile(resolve(process.argv[2]), 'utf8'),
);
if (
  !description.title ||
  !Array.isArray(description.files) ||
  !Array.isArray(description.changes)
)
  throw new Error('Release title, files and changes are required');
const hash = createHash('sha256');
for (const name of [...description.files].sort()) {
  if (
    !/^(?:apps|packages|server|deploy|tests|workers)\//.test(name) ||
    name.includes('..') ||
    /\.(?:env|pem|key)$|node_modules|release-manifest\.json/i.test(name)
  )
    throw new Error('Invalid release source path');
  hash.update(name);
  hash.update(await readFile(resolve(root, name)));
}
const builtAt = new Date().toISOString();
const manifest = {
  ...description,
  id:
    builtAt.replace(/[^0-9]/g, '').slice(0, 14) +
    '-' +
    hash.copy().digest('hex').slice(0, 8),
  builtAt,
  sourceDigest: hash.digest('hex'),
  operator: description.operator || 'Codex',
};
await writeFile(
  resolve(root, 'server/release-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  JSON.stringify({ version: manifest.id, files: manifest.files.length }),
);
