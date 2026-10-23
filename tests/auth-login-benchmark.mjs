import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  setImmediate as nextTurn,
  setTimeout as sleep,
} from 'node:timers/promises';

// Synthetic database latency, real password hashing, and no database connection.
const baselineCommit =
  process.argv[2] || '87e33c289bef8672d5ecc17f69ad2abcad42e290';
const roundTripMs = 100;
const state = { queries: [], pending: new Set(), user: null };
const pool = {
  query(statement) {
    state.queries.push(statement);
    const operation = (async () => {
      await sleep(roundTripMs);
      if (statement.startsWith('SELECT locked_until')) return { rows: [] };
      if (statement.startsWith('SELECT * FROM admin_users'))
        return { rows: [state.user] };
      if (statement.startsWith('SELECT u.*'))
        return { rows: [{ ...state.user, login_blocked: false }] };
      return { rows: [] };
    })();
    state.pending.add(operation);
    operation.then(
      () => state.pending.delete(operation),
      () => state.pending.delete(operation),
    );
    return operation;
  },
};
const moduleUrl = (source) =>
  `data:text/javascript,${encodeURIComponent(source)}`;
globalThis.__authBenchmarkPool = pool;
const baseline = execFileSync(
  'git',
  ['show', `${baselineCommit}:server/auth.mjs`],
  { encoding: 'utf8' },
);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0].endsWith('/auth.mjs')) {
      if (specifier === './database.mjs')
        return {
          url: moduleUrl(
            'export const pool=globalThis.__authBenchmarkPool;export const sql=(p)=>p;export const lock=async()=>true;export const unlock=async()=>{};',
          ),
          shortCircuit: true,
        };
      if (specifier === './local-provider.mjs')
        return {
          url: moduleUrl('export const readCredentials=async()=>({});'),
          shortCircuit: true,
        };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('/auth.mjs?auth-benchmark=baseline'))
      return { format: 'module', source: baseline, shortCircuit: true };
    return next(url, context);
  },
});
try {
  const before = await import('../server/auth.mjs?auth-benchmark=baseline');
  const after = await import('../server/auth.mjs?auth-benchmark=optimized');
  state.user = {
    id: 'synthetic-owner',
    username: 'owner',
    display_name: 'Synthetic owner',
    password_hash: await after.hashPassword('QA-benchmark-password-123'),
    role: 'admin',
    enabled: 1,
    created_at: Date.now(),
  };
  const results = {};
  for (const [label, auth] of [
    ['baseline', before],
    ['optimized', after],
  ]) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      state.queries.length = 0;
      const started = performance.now();
      await auth.authAction(
        {
          action: 'auth_login',
          username: 'owner',
          password: 'QA-benchmark-password-123',
        },
        { headers: {}, socket: { remoteAddress: '192.0.2.1' } },
        { setHeader() {} },
        null,
      );
      samples.push({
        milliseconds: Math.round(performance.now() - started),
        queriesBeforeResponse: state.queries.length,
      });
      await nextTurn();
      while (state.pending.size) await Promise.all([...state.pending]);
    }
    results[label] = {
      samples,
      medianMs: samples
        .map((sample) => sample.milliseconds)
        .sort((a, b) => a - b)[2],
    };
  }
  console.log(
    JSON.stringify(
      {
        baselineCommit,
        syntheticDatabaseRoundTripMs: roundTripMs,
        samplesPerVersion: 5,
        realScrypt: true,
        ...results,
      },
      null,
      2,
    ),
  );
} finally {
  hook.deregister();
  delete globalThis.__authBenchmarkPool;
}
