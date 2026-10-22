// Derived tables are rebuildable. Source writes and invalidations share a transaction.
export async function migrateWorkspaceReads(pool, engine) {
  const json = engine === 'mysql' ? 'json' : 'jsonb';
  const sourceKey = engine === 'mysql'
    ? 'varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'
    : 'varchar(512)';
  const statements = [
    `CREATE TABLE IF NOT EXISTS workspace_read_versions (collection varchar(32) PRIMARY KEY, revision bigint NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS workspace_read_dirty (kind varchar(16) NOT NULL, source_key ${sourceKey} NOT NULL, revision bigint NOT NULL DEFAULT 1, PRIMARY KEY(kind,source_key))`,
    `CREATE TABLE IF NOT EXISTS workspace_read_rows (
      collection varchar(32) NOT NULL, id varchar(160) NOT NULL, source_key ${sourceKey} NOT NULL,
      market varchar(8) NOT NULL, category varchar(160) NOT NULL, score double precision,
      grade varchar(32) NOT NULL, rating_status varchar(32) NOT NULL, review_status varchar(32) NOT NULL,
      collection_status varchar(32) NOT NULL, favorite integer NOT NULL, collected_at varchar(40) NOT NULL,
      source_label varchar(160) NOT NULL, platform varchar(100) NOT NULL, ownership varchar(160) NOT NULL,
      site_id varchar(160) NOT NULL, newness varchar(16) NOT NULL, recent_discovery integer NOT NULL,
      search_text text NOT NULL, payload ${json} NOT NULL, PRIMARY KEY(collection,id))`,
    `CREATE TABLE IF NOT EXISTS workspace_read_links (collection varchar(32) NOT NULL, id varchar(160) NOT NULL, relation varchar(32) NOT NULL, target varchar(180) NOT NULL, PRIMARY KEY(collection,id,relation,target))`,
    `CREATE TABLE IF NOT EXISTS workspace_overview_snapshots (market varchar(8) PRIMARY KEY, revision bigint NOT NULL, generated_at varchar(40) NOT NULL, payload ${json} NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS workspace_statistic_rows (kind varchar(20) NOT NULL, market varchar(8) NOT NULL, variant varchar(20) NOT NULL, position integer NOT NULL, subtype varchar(20) NOT NULL, payload ${json} NOT NULL, PRIMARY KEY(kind,market,variant,position))`,
  ];
  for (const statement of statements) await pool.query(statement);
  if (engine === 'mysql') {
    let repaired = false;
    for (const table of ['workspace_read_dirty', 'workspace_read_rows']) {
      const found = await pool.query(
        "SELECT collation_name AS collation_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=$1 AND column_name='source_key'",
        [table],
      );
      if (found.rows[0]?.collation_name === 'utf8mb4_bin') continue;
      await pool.query(`ALTER TABLE ${table} MODIFY source_key ${sourceKey} NOT NULL`);
      repaired = true;
    }
    // Older accent-insensitive queue keys could have collapsed distinct source records.
    if (repaired) await pool.query("INSERT INTO workspace_read_dirty(kind,source_key) SELECT 'keywords',natural_key FROM research_keywords ON DUPLICATE KEY UPDATE revision=workspace_read_dirty.revision+1");
  }
  for (const [table, name, columns] of [
    [
      'workspace_read_rows',
      'workspace_read_market_score',
      'collection,market,score,id',
    ],
    [
      'workspace_read_rows',
      'workspace_read_market_date',
      'collection,market,collected_at,id',
    ],
    [
      'workspace_read_rows',
      'workspace_read_review',
      'collection,market,review_status,score,id',
    ],
    ['workspace_read_rows', 'workspace_read_source', 'collection,source_key'],
    ['workspace_read_rows', 'workspace_read_site', 'collection,site_id,id'],
    [
      'workspace_read_links',
      'workspace_read_relation',
      'collection,relation,target,id',
    ],
  ]) {
    if (engine === 'mysql') {
      const found = await pool.query(
        'SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=$1 AND index_name=$2',
        [table, name],
      );
      if (found.rows.length) continue;
    }
    await pool.query(
      `CREATE INDEX ${engine === 'mysql' ? '' : 'IF NOT EXISTS '}${name} ON ${table}(${columns})`,
    );
  }
  for (const collection of ['business', 'keywords', 'tasks', 'published'])
    await pool.query(
      engine === 'mysql'
        ? 'INSERT IGNORE INTO workspace_read_versions(collection) VALUES($1)'
        : 'INSERT INTO workspace_read_versions(collection) VALUES($1) ON CONFLICT DO NOTHING',
      [collection],
    );
  for (const [table, kind, key, channel] of [
    ['workspace_documents', 'business', 'name', 'business'],
    ['research_keywords', 'keywords', 'natural_key', 'keywords'],
    ['research_jobs', 'tasks', 'id', 'tasks'],
  ]) {
    if (engine === 'postgres') {
      await pool.query(`CREATE OR REPLACE FUNCTION workspace_read_${kind}_changed() RETURNS trigger AS $$
        DECLARE source text; BEGIN
          IF TG_OP='DELETE' THEN source=OLD.${key}; ELSE source=NEW.${key}; END IF;
          ${kind === 'business' ? "IF source NOT LIKE 'business:%' THEN RETURN NULL; END IF;" : ''}
          UPDATE workspace_read_versions SET revision=revision+1 WHERE collection='${channel}';
          ${kind === 'tasks' ? '' : `INSERT INTO workspace_read_dirty(kind,source_key) VALUES('${kind}',source) ON CONFLICT(kind,source_key) DO UPDATE SET revision=workspace_read_dirty.revision+1;`}
          RETURN NULL; END; $$ LANGUAGE plpgsql`);
      const trigger = `workspace_read_${kind}_v1`;
      await pool.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='${trigger}') THEN CREATE TRIGGER ${trigger} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION workspace_read_${kind}_changed(); END IF; END $$`,
      );
    } else
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const trigger = `workspace_read_${kind}_${operation.toLowerCase()}_v1`;
        const found = await pool.query(
          'SELECT 1 FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=$1',
          [trigger],
        );
        if (found.rows.length) continue;
        const source = `${operation === 'DELETE' ? 'OLD' : 'NEW'}.${key}`;
        await pool.query(`CREATE TRIGGER ${trigger} AFTER ${operation} ON ${table} FOR EACH ROW BEGIN
        ${kind === 'business' ? `IF ${source} LIKE 'business:%' THEN` : ''}
        UPDATE workspace_read_versions SET revision=revision+1 WHERE collection='${channel}';
        ${kind === 'tasks' ? '' : `INSERT INTO workspace_read_dirty(kind,source_key) VALUES('${kind}',${source}) ON DUPLICATE KEY UPDATE revision=revision+1;`}
        ${kind === 'business' ? 'END IF;' : ''}
        END`);
      }
  }
}
