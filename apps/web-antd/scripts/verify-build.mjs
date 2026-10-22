import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] || 'dist');
const files = await readdir(resolve(output, 'css'));
const css = (await Promise.all(files.filter((file) => file.endsWith('.css')).map((file) => readFile(resolve(output, 'css', file), 'utf8')))).join('\n');
for (const name of ['flex', 'items-center', 'h-full', 'relative', 'overflow-hidden']) {
  assert.match(css, new RegExp(`\\.${name}(?=[{,:])`), `Missing layout utility: ${name}; check Tailwind source scanning`);
}
console.log('Frontend build contains required layout utilities.');
