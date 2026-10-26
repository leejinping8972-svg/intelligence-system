import process from 'node:process';

import { pool } from './database.mjs';
import { recordSourceCall } from './source-usage.mjs';

const providers = new Map([
  ['api.fda.gov', 'openfda'],
  ['api.gdeltproject.org', 'gdelt'],
  ['api.ods.od.nih.gov', 'dsld'],
  ['clinicaltrials.gov', 'pubmed'],
  ['eutils.ncbi.nlm.nih.gov', 'pubmed'],
  ['pubchem.ncbi.nlm.nih.gov', 'pubchem'],
  ['www.ebi.ac.uk', 'pubmed'],
  ['www.googleapis.com', 'youtube'],
]);

// This wrapper is enabled only in the dedicated public collector child process.
export function publicUsageFetch(fetcher, journal, jobId) {
  return async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const sourceId = providers.get(url.hostname);
    if (!sourceId) return fetcher(input, options);
    return journal({ jobId, task: '每日公共情报采集', step: url.pathname, sourceId, market: 'ALL', project: () => ({ requests: 1 }) }, () => fetcher(input, options));
  };
}
if (process.env.HCI_SOURCE_USAGE_JOB_ID) {
  globalThis.fetch = publicUsageFetch(globalThis.fetch, recordSourceCall, process.env.HCI_SOURCE_USAGE_JOB_ID);
  process.once('beforeExit', () => pool.end());
}
