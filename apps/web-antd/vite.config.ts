import process from 'node:process';

import { defineConfig } from '@vben/vite-config';

import { loadEnv } from 'vite';

import { tailwindSources } from './tailwind-sources';

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    application: { injectAppLoading: env.VITE_HCI_SERVER !== 'true' },
    vite: {
      plugins: [tailwindSources()],
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // mock代理目标地址
            target: 'http://localhost:5320/api',
            ws: true,
          },
        },
      },
    },
  };
});
