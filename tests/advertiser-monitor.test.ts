import type {
  Ad,
  Product,
  Site,
} from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it } from 'vitest';
import { groupAdvertisers } from '../apps/web-antd/src/views/intelligence/advertisers';
import { focusedMonitorRows } from '../apps/web-antd/src/views/intelligence/focused-monitors';
import { digest } from '../server/competitor-monitor-domain.mjs';
import { computed } from 'vue';
import { useFilteredSelection } from '../apps/web-antd/src/views/intelligence/resource-list';
import { marketQuery } from '../apps/web-antd/src/views/intelligence/market-navigation';
const ad = (id: string, extra: Partial<Ad> = {}) =>
  ({
    id,
    pageId: '123',
    market: 'US',
    brand: 'Same name',
    status: '投放中',
    dataNature: 'collected',
    ...extra,
  }) as Ad;
describe('advertiser identities and selection', () => {
  it('clears the previous advertiser identity on market change and keeps the advertiser tab', () => {
    expect(
      marketQuery('/ads', { pageId: '123', tab: 'advertisers', site: 'old' }),
    ).toEqual({ tab: 'advertisers' });
  });
  it('merges duplicate Page IDs only within the same market, leaves same-name pages distinct', () => {
    const rows = groupAdvertisers(
      [
        ad('a'),
        ad('b'),
        ad('c', { market: 'VN' }),
        ad('d', { pageId: '456' }),
        ad('missing', { pageId: undefined }),
      ],
      [],
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === 'US:123')?.adIds).toEqual(['a', 'b']);
    expect(
      new Set(rows.map((r) => digest(`advertiser:${r.market}:${r.pageId}`)))
        .size,
    ).toBe(3);
  });
  it('retains all linked sites in-market and only real collection timestamps', () => {
    const sites = [
      { id: 's', market: 'US', domain: 'us.example' },
      { id: 'v', market: 'VN', domain: 'vn.example' },
    ] as Site[];
    const [row] = groupAdvertisers(
      [
        ad('a', {
          siteIds: ['s', 'v'],
          lastCollectedAt: '2026-10-19T00:00:00Z',
        }),
        ad('b', {
          siteIds: ['s'],
          status: '已停止',
          lastCollectedAt: '2026-10-20T00:00:00Z',
        }),
      ],
      sites,
    );
    expect(row?.siteIds).toEqual(['s']);
    expect(row?.active).toBe(1);
    expect(row?.stopped).toBe(1);
    expect(row?.collectedAt).toBe('2026-10-20T00:00:00Z');
    expect(
      groupAdvertisers(
        [ad('x', { firstSeenAt: '2026-10-20T00:00:00Z' })],
        [],
      )[0]?.collectedAt,
    ).toBeUndefined();
  });
  it('chooses a real representative when the same advertiser also has demo material', () => {
    const [row] = groupAdvertisers(
      [ad('demo', { dataNature: 'demo' }), ad('real')],
      [],
    );
    expect(row?.adId).toBe('real');
    expect(row?.dataNature).toBe('collected');
  });
  it('selects all advertisers across pages without truncating at capacity', () => {
    const rows = computed(() =>
      groupAdvertisers(
        Array.from({ length: 121 }, (_, i) =>
          ad(String(i), { pageId: String(1000 + i) }),
        ),
        [],
      ),
    );
    const selection = useFilteredSelection(rows);
    selection.selectAll();
    expect(selection.selected.value).toHaveLength(121);
    expect(selection.selected.value.map((r) => r.adId)).toHaveLength(121);
    selection.clear();
    expect(selection.ids.value).toEqual([]);
  });
});
describe('focused monitors', () => {
  const product = {
    id: 'p',
    title: 'Product',
    brand: 'Brand',
    market: 'US',
  } as Product;
  const legacy = {
    id: 'legacy',
    productId: 'p',
    enabled: true,
    frequency: '每周',
  };
  const targets = [
    {
      id: 'site',
      kind: 'site' as const,
      label: 'site.example',
      market: 'US' as const,
      siteId: 's',
      pageId: '',
      hour: 8,
      maxRequests: 10,
      enabled: false,
    },
    {
      id: 'advertiser',
      kind: 'advertiser' as const,
      label: 'Same name',
      market: 'VN' as const,
      siteId: '',
      pageId: '123',
      hour: 9,
      maxRequests: 3,
      enabled: true,
    },
  ];
  it('includes all three types, paused targets, and current runner status', () => {
    const rows = focusedMonitorRows(
      [product],
      [legacy],
      targets,
      [
        {
          id: 'site',
          market: 'US',
          status: 'partial',
          day: '2026-10-20',
          requests: 2,
          errors: ['429'],
        },
      ],
      'ALL',
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.target?.id === 'site')?.run?.status).toBe(
      'partial',
    );
    expect(rows.find((r) => r.kind === 'product')?.legacy).toBe(legacy);
    expect(rows.find((r) => r.kind === 'site')?.enabled).toBe(false);
  });
  it('filters by market while retaining targets even if source resources are missing', () => {
    expect(
      focusedMonitorRows([], [], targets, [], 'US').map((r) => r.kind),
    ).toEqual(['site']);
    expect(
      focusedMonitorRows([product], [legacy], targets, [], 'VN').map(
        (r) => r.kind,
      ),
    ).toEqual(['advertiser']);
    expect(focusedMonitorRows([], [legacy], targets, [], 'ALL')).toHaveLength(
      2,
    );
  });
});
