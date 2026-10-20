// Standalone synthetic browser acceptance: no target websites or provider calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { renderProductPage } from './site-page-fallbacks.mjs';
import { fetchPublicPage } from './safe-web.mjs';
if (!process.env.PRODUCT_BROWSER_QA_EXECUTABLE)
  throw new Error('Set a local Chromium path for synthetic QA');
const url = 'https://store.example/products/dynamic';
let blocked = 0;
const page = await renderProductPage(
  url,
  { domain: 'store.example' },
  {
    launch: (options) =>
      chromium.launch({
        ...options,
        executablePath: process.env.PRODUCT_BROWSER_QA_EXECUTABLE,
        env: {
          ...options.env,
          SystemRoot: process.env.SystemRoot || '',
          TEMP: process.env.TEMP || '/tmp',
        },
      }),
    fetchPage: async (target, _depth, _types, options) => {
      if (target.startsWith('http://127.0.0.1')) {
        blocked++;
        return fetchPublicPage(target);
      }
      if (target === url) {
        assert.equal(options.allowedDomain, 'store.example');
        return {
          url: target,
          html: '<html><body><div id="app"></div><script src="/app.js"></script></body></html>',
          contentType: 'text/html',
        };
      }
      assert.equal(target, 'https://store.example/app.js');
      return {
        url: target,
        contentType: 'application/javascript',
        html: `
      const node=document.createElement('script');node.type='application/ld+json';node.textContent=JSON.stringify({'@type':'Product',name:'Synthetic Creatine'});document.body.append(node);
      fetch('http://127.0.0.1/private').catch(()=>{});
    `,
      };
    },
  },
);
assert.match(page.html, /Synthetic Creatine/);
assert.equal(blocked, 1);
assert.equal(page.resourceRequests, 3);
console.warn(
  'Synthetic Chromium QA passed: JS product rendered, private request blocked by pinned reader, no external traffic.',
);
