import { nextTick, reactive } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceChangeTracker } from '../apps/web-antd/src/views/intelligence/workspace-change-tracker';

const trackers: Array<ReturnType<typeof createWorkspaceChangeTracker>> = [];
afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop();
});

function setup() {
  const records = reactive([{ id: 'a', nested: { title: 'old' } }]);
  const changed = vi.fn();
  const removed = vi.fn();
  const tracker = createWorkspaceChangeTracker({
    entries: () => new Map(records.map((record) => [record.id, record])),
    changed,
    removed,
  });
  trackers.push(tracker);
  return { records, tracker, changed, removed };
}

describe('record change tracking', () => {
  it('batches nested edits and captures same-turn edits before a readback', async () => {
    const { records, tracker, changed } = setup();
    records[0]!.nested.title = 'first';
    records[0]!.nested.title = 'latest';
    expect(changed).not.toHaveBeenCalled();
    tracker.capture(['a']);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0]![2]).toContain('latest');
    await nextTick();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('distinguishes local membership changes from remote additions and removals', async () => {
    const { records, tracker, changed, removed } = setup();
    records.push({ id: 'b', nested: { title: 'server' } });
    tracker.acceptRemote();
    await nextTick();
    expect(changed).not.toHaveBeenCalled();
    records.splice(0, 1);
    tracker.acceptRemote();
    await nextTick();
    expect(removed).not.toHaveBeenCalled();
    records.push({ id: 'c', nested: { title: 'local' } });
    await tracker.flush();
    expect(changed.mock.calls.map(([key]) => key)).toEqual(['c']);
    records.splice(0, 1);
    await tracker.flush();
    expect(removed).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('leaves untouched record payloads unread during a capture and stops old observers', async () => {
    const { records, tracker, changed } = setup();
    records.push({ id: 'b', nested: { title: 'untouched' } });
    tracker.acceptRemote();
    await nextTick();
    const read = vi.fn(() => 'body');
    Object.defineProperty(records[1]!.nested, 'body', {
      enumerable: true,
      get: read,
    });
    tracker.capture(['a']);
    expect(read).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    tracker.stop();
    records[0]!.nested.title = 'after disposal';
    await nextTick();
    expect(changed).not.toHaveBeenCalled();
  });
});
