import { decodeUsageArray, encodeUsageArray } from './usage-snapshot-codec.mjs';

const validEvents = (events) =>
  Array.isArray(events) &&
  events.every(
    (event) =>
      typeof event?.id === 'string' && typeof event.sourceId === 'string',
  );

export async function encodeUsageSnapshot(snapshot) {
  if (!validEvents(snapshot.events))
    throw new TypeError('Invalid usage snapshot events');
  return {
    ...(await encodeUsageArray(snapshot.events)),
    checkedAt: snapshot.checkedAt,
  };
}

export async function decodeUsageSnapshot(value, now = Date.now()) {
  if (
    !Number.isFinite(Date.parse(value?.checkedAt)) ||
    Date.parse(value.checkedAt) > now + 60_000
  )
    return;
  const events = await decodeUsageArray(value);
  if (validEvents(events)) return { events, checkedAt: value.checkedAt };
}
