export function keywordIdentity(value: null | string | undefined): string;
export function keywordStorageIdentity(
  value: null | string | undefined,
): string;
export function keywordIdentitySql(
  sql: (postgres: string, mysql: string) => string,
  alias: string,
  options?: { cached?: boolean },
): string;
