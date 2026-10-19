interface PlatformKeyword {
  id: string;
  term: string;
  market: string;
}

export function platformProductSelection(
  available: readonly PlatformKeyword[],
  selectedIds: readonly string[],
  ready: boolean,
) {
  const ids = new Set(selectedIds);
  const records = available.filter((record) => ids.has(record.id));
  const selectedMarkets = new Set(records.map((record) => record.market));
  const market = selectedMarkets.size === 1 ? records[0]?.market : undefined;
  let reason = '';
  if (!ready) reason = '正在同步工作区，请稍后再试';
  else if (ids.size === 0) reason = '请先勾选要获取商品的关键词';
  else if (records.length !== ids.size)
    reason = '勾选记录已变化，请重新勾选，避免只提交部分关键词';
  else if (records.length > 100) reason = '每次最多选择100个关键词';
  else if (!market) reason = '请只勾选同一市场的关键词，再获取平台商品';
  else if (!['US', 'MX', 'VN'].includes(market))
    reason = '所选关键词的市场暂不支持平台商品采集';
  return {
    records,
    terms: records.map((record) => record.term),
    market,
    disabled: Boolean(reason),
    reason,
  };
}
