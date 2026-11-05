// This marker survives restarts and coalesces writes from every worker. It is
// independent of the read model so publishing a summary never marks itself dirty.
export const USAGE_DIRTY_NAME = 'usage:dirty:v1';
export const USAGE_SUMMARY_NAME = 'read:usage:summary:v1';
export const usageDocument = (name) =>
  /^(?:competitor:request:|content:job:|source-usage:event:)/.test(name);
let failedGeneration = 0;
let recoveredGeneration = 0;

export async function markUsageChanged(connection, engine = 'postgres') {
  try {
    await connection.query(
      engine === 'mysql'
        ? 'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON DUPLICATE KEY UPDATE revision=revision+1'
        : 'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET revision=workspace_documents.revision+1',
      [USAGE_DIRTY_NAME, {}],
    );
    return true;
  } catch (error) {
    // Accounting projections must not turn a completed paid call into a failure.
    console.warn('Usage change marker unavailable', error.code || 'WRITE_FAILED');
    failedGeneration++;
    return false;
  }
}

export async function retryUsageMarker(connection, engine) {
  if (failedGeneration === recoveredGeneration) return;
  const captured = failedGeneration;
  if (await markUsageChanged(connection, engine)) recoveredGeneration = captured;
}
