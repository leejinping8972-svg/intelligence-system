import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import process from 'node:process';

import pg from 'pg';

// Executed only in an isolated QA container with its own /etc/hosts override and disposable MySQL.
const original = process.env.DATABASE_URL;
if (!original || !process.env.MYSQL_QA) throw new Error('Isolated MySQL QA environment required');
const name = `mysql_qa_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: original });
await admin.query(`CREATE DATABASE ${name}`);
const url = new URL(original); url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_CONFIG_FILE = `/tmp/${name}/database.enc.json`;
const { migrate, pool, saveKeyword } = await import('./store.mjs');
const { migrateCredentials } = await import('./local-provider.mjs');
const { hashPassword } = await import('./auth.mjs');
async function child(code) {
  const worker = spawn(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
  const status = await new Promise((resolve) => worker.on('exit', resolve));
  assert.equal(status, 0, 'isolated QA child must pass');
}
try {
  await migrate();
  await migrateCredentials({ RESEARCH_ACCESS_KEY: 'QA-mysql-bootstrap', SORFTIME_MCP_TOKEN: 'QA-fake-token-never-sent' });
  await saveKeyword({ id: 'qa-existing', term: 'QA existing magnesium', market: 'US', category: '矿物质', source: 'QA fixture', series: [], growth: null, dataNature: 'collected', favorite: true, productIds: [], siteIds: [], reviewStatus: 'selected' });
  const hash = await hashPassword('QA-mysql-owner-123');
  await pool.query('INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)', [randomUUID(), 'owner', 'QA Owner', hash, 'admin', Date.now()]);
  await child(`
    import { readFile } from 'node:fs/promises';
    import { databaseAction } from './database-admin.mjs';
    const input = { host:'rm-bp17h3w0e2dte4l4r8o.mysql.rds.aliyuncs.com',database:'leo',user:'root',password:await readFile('/qa/password','utf8'),ca:await readFile('/qa/ca.pem','utf8') };
    const test = await databaseAction({ ...input,action:'database_test' });
    if (!test.connected || !test.encrypted) throw new Error('SSL verification failed');
    const result = await databaseAction({ ...input,action:'database_migrate',confirm:'migrate-to-leo' });
    if (result.counts.research_keywords!==1 || result.counts.admin_users!==1 || result.counts.provider_configs!==1) throw new Error('Migration counts wrong');
    console.warn('PASS: PostgreSQL to MySQL 8 SSL migration; all rows and encrypted provider settings verified');
  `);
  await child(`
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    import { createServer } from 'node:http';
    import { Buffer } from 'node:buffer';
    import { migrate,pool,saveKeyword,usage } from './store.mjs';
    import { engine,lock,unlock,putDocument } from './database.mjs';
    import { readCredentials } from './local-provider.mjs';
    import { authAction,sessionUser } from './auth.mjs';
    const mock = createServer(async(req,res)=>{
      const chunks=[];for await(const c of req)chunks.push(c);
      const input=JSON.parse(Buffer.concat(chunks));
      const generatedAt=new Date().toISOString();
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({generatedAt,...(input.sources.includes('google_trends')?{trends:input.keywords.map(keyword=>({keyword,market:'US',series:[20,40],points:[{date:'2026-09-01',value:20},{date:'2026-10-01',value:40}],source:'QA mock',status:'success'}))}:{suggestions:[{market:'US',items:[{term:'QA magnesium gummies',source:'Sorftime · Amazon'}],sources:[{source:'Sorftime · Amazon',count:1,status:'success',message:'QA mock only'}]}],usage:{sorftimeCalls:1}})}));
    });
    await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
    process.env.COLLECTOR_URL='http://127.0.0.1:'+mock.address().port;
    const { runJob }=await import('./runner.mjs');
    assert.equal(engine,'mysql');await migrate();
    assert.equal((await readCredentials()).SORFTIME_MCP_TOKEN,'QA-fake-token-never-sent');
    const response={setHeader(name,value){this.cookie=value;}};
    const request={headers:{'x-forwarded-for':'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
    const signed=await authAction({action:'auth_login',username:'owner',password:'QA-mysql-owner-123'},request,response,null);
    assert.equal(signed.user.role,'admin');
    const user=await sessionUser({headers:{cookie:response.cookie.split(';')[0]}});
    assert.ok(user);
    const connection=await pool.connect();assert.equal(await lock(connection),true);await unlock(connection);connection.release();
    await putDocument('workspace_documents','business:sites:qa',{id:'qa'});
    await putDocument('workspace_documents','business:sites:qa',{id:'qa',updated:true});
    assert.equal((await pool.query("SELECT value FROM workspace_documents WHERE name='business:sites:qa'")).rows[0].value.updated,true);
    const old=(await pool.query("SELECT data FROM research_keywords WHERE natural_key='US|qa existing magnesium'")).rows[0].data;
    await saveKeyword({...old,favorite:false,reviewStatus:'pending'});
    assert.equal((await pool.query("SELECT data FROM research_keywords WHERE natural_key='US|qa existing magnesium'")).rows[0].data.favorite,true);
    const id=randomUUID(),input={seeds:['QA magnesium'],markets:['US'],sources:['sorftime'],depth:1,limit:2,sorftimeRequestLimit:1};
    await pool.query('INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',[id,randomUUID(),input,{}]);
    const job=(await pool.query('SELECT * FROM research_jobs WHERE id=$1',[id])).rows[0];
    await runJob(job);
    assert.equal((await pool.query('SELECT status FROM research_jobs WHERE id=$1',[id])).rows[0].status,'awaiting_review');
    assert.deepEqual(await usage(id),{confirmed:1,reserved:0});
    await runJob({...job,checkpoint:{}});assert.deepEqual(await usage(id),{confirmed:1,reserved:0});
    await pool.end();await new Promise(resolve=>mock.close(resolve));
    console.warn('PASS: MySQL login, sessions, queue locks, JSON upserts, favorites, durable research and paid request replay');
  `);
} finally {
  await pool.end(); await admin.query(`DROP DATABASE ${name}`); await admin.end();
  await rm(`/tmp/${name}`, { recursive: true, force: true });
}
