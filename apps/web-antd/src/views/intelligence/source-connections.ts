export const connectionFields: Record<string, { fields: string; kind: string }> = {
  semrush: { fields: 'Semrush API Key', kind: 'API Key' },
  sorftime: { fields: 'MCP ACCESS TOKEN', kind: 'MCP Token' },
  brave: { fields: 'Brave Search API Key', kind: 'API Key' },
  youtube: { fields: 'YouTube Data API v3 · API Key', kind: 'API Key' },
  scrapecreators: { fields: 'ScrapeCreators API Key', kind: 'API Key' },
  firecrawl: { fields: 'Firecrawl API Key、浏览器与托管备用开关', kind: 'API Key + 策略' },
  official_sites: { fields: '服务器浏览器开关、Firecrawl 托管备用策略', kind: '采集策略' },
  analysis: { fields: '接口地址、模型名称、API Key、输出上限', kind: '模型连接' },
  westmonth: { fields: 'access_token、允许使用登录会话', kind: '登录会话' },
};
