# 知衡独立站发现 Worker

该 Worker 接收关键词与市场，使用 Brave Search 发现候选域名，再直接访问目标官网，依据商品结构化数据、价格、购物车、结账入口和建站平台信号判断是否为可销售商品的独立站。

## 服务端密钥

部署后在 Cloudflare Worker 中配置两个 Secret：

- `BRAVE_SEARCH_API_KEY`：Brave Search API 密钥，只保存在 Cloudflare。
- `RESEARCH_ACCESS_KEY`：后台调用 Worker 时使用的访问码。访问码填入“数据源与设置”，只保存在当前浏览器。

```powershell
pnpm dlx wrangler@4.45.0 secret put BRAVE_SEARCH_API_KEY
pnpm dlx wrangler@4.45.0 secret put RESEARCH_ACCESS_KEY
```

## 部署与验证

```powershell
pnpm dlx wrangler@4.45.0 deploy
node --test test.mjs
```

单次请求最多执行 3 个“关键词 × 市场”组合，每组最多保留 6 家验证通过的站点。Brave 搜索结果只用于发现候选网址；系统不持久化搜索摘要和排名，只保存从目标官网直接核验的站点与商品事实。
