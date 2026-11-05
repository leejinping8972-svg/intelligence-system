import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { deflateRaw, inflateRaw } from 'node:zlib';

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);

export async function encodeUsageSnapshot(snapshot) {
  return {
    version: 1,
    codec: 'deflate-json-v1',
    checkedAt: snapshot.checkedAt,
    body: (
      await compress(Buffer.from(JSON.stringify(snapshot.events)))
    ).toString('base64'),
  };
}

export async function decodeUsageSnapshot(value, now = Date.now()) {
  if (
    value?.version !== 1 ||
    value.codec !== 'deflate-json-v1' ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    Date.parse(value.checkedAt) > now + 60_000
  )
    return;
  try {
    const events = JSON.parse(
      (
        await decompress(Buffer.from(value.body, 'base64'), {
          maxOutputLength: 32 * 1024 * 1024,
        })
      ).toString('utf8'),
    );
    if (
      Array.isArray(events) &&
      events.every(
        (event) =>
          typeof event?.id === 'string' && typeof event.sourceId === 'string',
      )
    )
      return { events, checkedAt: value.checkedAt };
  } catch {
    // A damaged saved projection must never be displayed as zero usage.
  }
}
