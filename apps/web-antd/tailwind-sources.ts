import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

export function tailwindSources(): Plugin {
  let appRoot = '';
  return {
    name: 'intelligence-tailwind-sources',
    enforce: 'pre',
    configResolved(config) {
      appRoot = config.root;
    },
    async load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/design/src/css/global.css')) return;
      // Resolve sources before CSS imports are flattened or workspace links followed.
      const paths = [resolve(appRoot, '../../packages'), resolve(appRoot, 'src'), resolve(appRoot, 'index.html')];
      return `${await readFile(id, 'utf8')}\n${paths.map((path) => `@source '${path.replaceAll('\\', '/')}';`).join('\n')}`;
    },
  };
}
