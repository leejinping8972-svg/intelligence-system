# 广告与独立站统一采集

已入选关键词保留一个采集入口，新提交使用 `kind: ads, includeSearchSites: true`。旧任务未设置此字段时继续原广告流程，不迁移、不重放历史任务。

- 先执行 Brave Search 站点发现与官网电商核验，再执行 ScrapeCreators 广告及落地站核验。两路各有独立进度，搜索失败仍可处理广告，广告失败也不丢弃搜索结果。
- 按市场与规范化主机名（沿用 `hostnameRoot`，去除 www）存为同一站点，合并 `sources/sourceEvidence/keywordIds`，保留搜索链接、广告原文及落地链接。同一站点可关联多个关键词；不同市场分开。多个来源是发现证据，不代表销量、配方或功效成立。
- 每路每词最多10家站点；广告页数、广告数量和整批广告请求单独设上限。搜索每词一次发现流程，内部含官网核验。现有 Semrush 指标及请求 journal 优先复用，不购买额度。
- 新任务提交同时占用 market-submit 与 enrichment-submit 锁，事务内写任务及两类排队状态；旧搜索提交也识别双渠道任务，防止重复提交。取消清理本任务拥有的状态，保留结果和人工决定。
- 搜索、广告各自保存嵌套 checkpoint；收费请求沿用稳定 step。成功搜索不重复，广告分页从已保存的页码/游标继续。终态 partial 不自动重放未知收费请求。

验证命令：

```sh
node --test server/combined-discovery.test.mjs server/market-jobs.test.mjs server/enrichment.test.mjs
pnpm exec vitest run tests/platform-product-selection.test.ts tests/keyword-selection.test.ts tests/product-decisions.test.ts
pnpm --filter @vben/web-antd run typecheck
```

本功能专项32项后台、20项前端通过，合并现有平台商品/公共内容等回归后共117项后台、24项前端通过；服务器模式/history构建通过。浏览器合成数据验证广告运行时平台商品按钮独立可用、混合市场禁用、MX市场预填、双渠道提交 payload。未调用真实收费来源，未连接正式数据库。数据库提交事务/跨提交锁及真实服务权限需在发布会话的隔离 MySQL 回归中核验，不能将 mock 测试视为正式服务验收。
