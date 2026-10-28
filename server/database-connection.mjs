export function mysqlConnectionOptions(value) {
  return {
    host: value.host,
    port: 3306,
    user: value.user,
    password: value.password,
    database: value.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 12,
    connectTimeout: 10_000,
    decimalNumbers: true,
    ...(value.tlsMode === 'plain'
      ? {}
      : {
          ssl: {
            rejectUnauthorized: true,
            verifyIdentity: true,
            ...(value.ca ? { ca: value.ca } : {}),
          },
        }),
  };
}
export async function verifyMysqlConnection(connection, tlsMode = 'ssl') {
  const [rows] = await connection.query(
    'SELECT VERSION() AS version,DATABASE() AS name',
  );
  const [tls] = await connection.query("SHOW STATUS LIKE 'Ssl_cipher'");
  const encrypted = Boolean(tls[0]?.Value);
  if (tlsMode !== 'plain' && !encrypted)
    throw new Error('数据库连接没有使用SSL，已停止迁移');
  if (!String(rows[0].version).startsWith('8.'))
    throw new Error('此接入方案需要 MySQL 8.0，请核对实例版本');
  return { version: rows[0].version, database: rows[0].name, encrypted };
}
