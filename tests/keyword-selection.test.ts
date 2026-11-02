import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it } from 'vitest';
import {
  rememberSelection,
  resolveSelection,
  requireCompleteSelection,
} from '../apps/web-antd/src/views/intelligence/keyword-selection';

const rows: Keyword[] = Array.from({ length: 35 }, (_, i) => ({
  id: `word-${i}`,
  term: i === 0 ? 'creatine gummies' : `creatine gummies ${i}`,
  market: 'US',
  category: '运动营养',
  source: '实采',
  series: [],
  growth: null,
  favorite: false,
  siteIds: [],
  productIds: [],
}));
describe('bulk keyword selection stays complete', () => {
  it('keeps 34 selected keywords across cloud identity replacement instead of reducing to 9', () => {
    const ids = rows.slice(1).map((r) => r.id),
      snapshots = rememberSelection(ids, rows);
    const fresh = rows.map((r, i) =>
      i > 0 && i <= 25 ? { ...r, id: `cloud-${i}` } : { ...r },
    );
    const resolved = requireCompleteSelection(ids, snapshots, fresh);
    expect(resolved).toHaveLength(34);
    expect(resolved.some((r) => r.term === 'creatine gummies')).toBe(false);
    expect(resolveSelection(ids, snapshots, fresh).tableKeys).toEqual(
      resolved.map((r) => r.id),
    );
  });
  it('rejects a 34-to-9 mismatch rather than submitting a subset', () => {
    const ids = rows.slice(1).map((r) => r.id),
      snapshots = rememberSelection(ids, rows);
    expect(() =>
      requireCompleteSelection(ids, snapshots, rows.slice(-9)),
    ).toThrow(/已勾选34个词，但只能匹配9个/);
    expect(ids).toHaveLength(34);
  });
  it('remembers earlier pages when a later page selection changes', () => {
    const first = rows.slice(0, 10),
      second = rows.slice(10, 20);
    const a = rememberSelection(
      first.map((r) => r.id),
      first,
    );
    const ids = [...first, ...second].map((r) => r.id);
    const b = rememberSelection(ids, second, a);
    expect(b.size).toBe(20);
    expect(requireCompleteSelection(ids, b, rows)).toHaveLength(20);
    expect(rememberSelection(ids.slice(1), rows, b).size).toBe(19);
  });
  it('matches term and market together and refuses duplicate or missing identities', () => {
    const old = { ...rows[0]!, id: 'old' };
    const snapshots = rememberSelection(['old'], [old]);
    expect(() =>
      requireCompleteSelection(['old'], snapshots, [
        { ...rows[0]!, market: 'VN' },
      ]),
    ).toThrow();
    expect(() =>
      requireCompleteSelection(['missing'], new Map(), rows),
    ).toThrow();
    expect(() =>
      requireCompleteSelection([rows[0]!.id, rows[0]!.id], new Map(), rows),
    ).toThrow();
  });
});
