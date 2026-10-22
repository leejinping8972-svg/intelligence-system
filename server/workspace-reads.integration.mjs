import mysql from 'mysql2/promise';

if (
  process.env.WORKSPACE_READ_MYSQL_QA !== 'disposable-only' ||
  process.env.QA_MYSQL_HOST !== 'workspace-read-qa-db'
)
  throw new Error(
    'Requires an isolated workspace-read-qa-db and WORKSPACE_READ_MYSQL_QA=disposable-only',
  );

const { exerciseWorkspaceReads } = await import('./workspace-reads.test.mjs');
const connection = await mysql.createConnection({
  host: 'workspace-read-qa-db',
  user: 'qa',
  password: 'disposable-qa-only',
  database: 'workspace_read_qa',
});
const pool = {
  async query(statement, params = []) {
    const values = [];
    const text = statement.replace(/\$(\d+)/g, (_, index) => {
      const value = params[Number(index) - 1];
      values.push(
        value && typeof value === 'object' ? JSON.stringify(value) : value,
      );
      return '?';
    });
    const [rows] = await connection.query(text, values);
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowCount: rows.affectedRows,
    };
  },
  async connect() {
    return { query: (...args) => pool.query(...args), release() {} };
  },
};
try {
  await pool.query(
    'CREATE TABLE workspace_documents(name varchar(512) PRIMARY KEY,value json NOT NULL,revision integer DEFAULT 1)',
  );
  await pool.query(
    'CREATE TABLE research_keywords(natural_key varchar(512) PRIMARY KEY,data json NOT NULL,updated_at timestamp DEFAULT CURRENT_TIMESTAMP)',
  );
  await pool.query(
    'CREATE TABLE research_jobs(id varchar(160) PRIMARY KEY,status varchar(32),cancelled boolean DEFAULT false)',
  );
  console.log(
    'MySQL synthetic read-model metrics:',
    await exerciseWorkspaceReads(pool, (_pg, my) => my, 'mysql'),
  );
} finally {
  await connection.end();
}
