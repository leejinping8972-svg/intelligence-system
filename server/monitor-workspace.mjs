// Monitor tabs do not need the product/media/keyword workspace snapshot.
export async function monitorWorkspace(input, { pool, sql }) {
  const revision = String((await pool.query("SELECT revision FROM workspace_read_versions WHERE collection='business'")).rows[0]?.revision || '0');
  if (input.revision === revision) return { revision };
  const [monitors, audit, legacy] = await Promise.all([
    pool.query("SELECT name,value FROM workspace_documents WHERE name LIKE 'business:monitors:%' ORDER BY name"),
    pool.query(sql(
      "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:audit:%' ORDER BY value->>'at' DESC,name DESC",
      "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:audit:%' ORDER BY JSON_UNQUOTE(JSON_EXTRACT(value,'$.at')) DESC,name DESC",
    )),
    pool.query("SELECT name,value FROM workspace_documents WHERE name LIKE 'business:legacyTasks:%' ORDER BY name"),
  ]);
  const ids = [...new Set(monitors.rows.map(row => row.value.productId).filter(Boolean))];
  const products = ids.length ? (await pool.query(
    `SELECT name,value FROM workspace_documents WHERE name IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
    ids.map(id => `business:products:${id}`),
  )).rows.map(({ value }) => ({ id: value.id, title: value.title, brand: value.brand, market: value.market, listSummary: true })) : [];
  return { revision, entries: [...monitors.rows, ...audit.rows, ...legacy.rows].map(row => ({ key: row.name.slice(9), value: row.value })), products };
}
