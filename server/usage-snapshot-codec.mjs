import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { deflateRaw, inflateRaw } from 'node:zlib';

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);
const chunkBytes = 4 * 1024 * 1024;

// Persist complete history as bounded JSON arrays. The limit applies to each
// chunk, so growing history cannot produce a successfully saved unreadable sum.
export async function encodeUsageArray(entries) {
  const chunks = [];
  let parts = [];
  let bytes = 2;
  const flush = async () => {
    if (!parts.length) return;
    const body = await compress(Buffer.from(`[${parts.join(',')}]`));
    chunks.push({
      index: chunks.length,
      bytes,
      count: parts.length,
      body: body.toString('base64'),
    });
    parts = [];
    bytes = 2;
  };
  for (const entry of entries) {
    const json = JSON.stringify(entry);
    if (json === undefined) throw new TypeError('Invalid usage snapshot entry');
    const size = Buffer.byteLength(json);
    if (size + 2 > chunkBytes)
      throw new RangeError('Usage snapshot entry exceeds chunk size');
    if (bytes + size + (parts.length ? 1 : 0) > chunkBytes) await flush();
    bytes += size + (parts.length ? 1 : 0);
    parts.push(json);
  }
  await flush();
  return {
    version: 1,
    codec: 'deflate-json-chunks-v1',
    count: entries.length,
    chunks,
  };
}

export async function decodeUsageArray(value) {
  if (value?.version !== 1) return;
  try {
    if (value.codec === 'deflate-json-v1') {
      // Legacy documents were generated internally with no write-side size
      // cap. Accept them in full, including the ones already over 32 MiB.
      const entries = JSON.parse(
        (await decompress(Buffer.from(value.body, 'base64'))).toString('utf8'),
      );
      return Array.isArray(entries) ? entries : undefined;
    }
    if (
      value.codec !== 'deflate-json-chunks-v1' ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      !Array.isArray(value.chunks)
    )
      return;
    const entries = [];
    for (const [index, chunk] of value.chunks.entries()) {
      if (
        chunk?.index !== index ||
        !Number.isSafeInteger(chunk.bytes) ||
        chunk.bytes < 2 ||
        chunk.bytes > chunkBytes ||
        !Number.isSafeInteger(chunk.count) ||
        chunk.count <= 0 ||
        entries.length + chunk.count > value.count
      )
        return;
      const raw = await decompress(Buffer.from(chunk.body, 'base64'), {
        maxOutputLength: chunkBytes,
      });
      if (raw.length !== chunk.bytes) return;
      const part = JSON.parse(raw.toString('utf8'));
      if (!Array.isArray(part) || part.length !== chunk.count) return;
      for (const entry of part) entries.push(entry);
    }
    if (entries.length === value.count) return entries;
  } catch {
    // Reject the entire projection: partial history must not become totals.
  }
}
