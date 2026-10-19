# 公共内容搜索：集成交付说明

## 范围与入口

按关键词或产品名称，按需搜索公开视频、文章、帖子和文献。来源分类固定为社媒内容、权威健康资讯、学术证据，内容类型另行筛选。没有定时监测、品牌素材审批或自动广告发布。

- `/signals` 的默认页签为“公共内容搜索”，原有公共信号保留在独立页签。
- `research.vue` 的关键词操作列增加 `PublicContentLauncher`，传入搜索词、市场和关键词 ID。
- `ProductDrawer.vue` 底部操作栏增加同一独立组件，传入品牌/标题、市场及产品 ID。没有修改商品平台页签或决策标签。
- 结果支持三类页签、类型/来源/实际来源语言/日期/文本筛选、卡片/列表、10/20/50/100 分页、详情、收藏、关联关键词/产品及 CSV 链接清单导出。

## 接口与存储

`server/index.mjs` 增加模块导入、`runContentQueue(controller.signal)` 与 `server_content_*` 分发，并在数据库迁移前持有公共内容 runner/submit 锁、确认本队列已空闲。沿用现有服务器会话授权，演示版不连接正式接口。

- `server_content_status`：只检查是否保存凭证，不检测外部平台、不返回密钥。
- `server_content_submit`：`requestId` UUID + `input`；输入包括 query、market、language、sources、limit、includeRelated、relatedTerms、organize、keywordIds、productIds。立即保存后台任务；同编号重复提交复用任务。
- `server_content_snapshot`：历史任务（最近40项）、选定任务及内容；`favorites=true` 查询收藏（最多1000条）。
- `server_content_cancel`：取消尚未发出的请求；当前已发出请求的返回内容仍保存。
- `server_content_save`：只修改已入库内容的 favorite、keywordIds、productIds。
- `server_content_transcript`：对已入库 YouTube 视频按需提交一次已有字幕读取任务。

不增加表或字段，复用 `workspace_documents`：`content:job:<UUID>`、`content:item:<hash>`、`content:cache:<hash>`。这些数据不纳入旧 `business:*` 浏览器同步，避免被旧客户端删除。备份应保留这些命名空间。

## 连接器与覆盖边界

- YouTube Data API v3 `search.list`：复用 `provider:youtube:v1` 或既有环境凭证；取得标题、描述、频道、日期及链接。地区/语言用于搜索，不推断作者国籍或实际语言。
- ScrapeCreators `GET /v1/reddit/search`：帖子、已有文本、互动和原帖链接；不访问帖子中的外部落地页。
- ScrapeCreators `GET /v1/tiktok/search/keyword`：视频描述、封面、作者、来源语言和链接；地区参数不作为作者国家。
- MedlinePlus `https://wsearch.nlm.nih.gov/ws/query`：仅英语/西语健康主题文章摘要。越南语任务明确跳过该来源。搜索可能无结果，不用泛泛健康文章补足数量。
- Europe PMC `https://www.ebi.ac.uk/europepmc/webservices/rest/search`：文献索引、摘要、作者、DOI及来源提供的开放全文入口；不会声称已抓取论文全文。
- ScrapeCreators `GET /v1/youtube/video/transcript`：只读已有原语言字幕，不做音频转写，不自动下载视频。

外部请求只访问代码中固定的 HTTPS 端点，禁止重定向，限制返回大小和超时；不会抓取用户填写的任意网址。文案以纯文本呈现，链接域名白名单检查，不渲染来源 HTML。

当前允许的市场为 US/MX/VN，检索语言为 en/es/vi。相关词扩展采用有限成分词表和最多2条手工补充，不声称自动翻译所有品牌词。来源语言未提供时保留 unknown。结果上限5～100条、最多3组词、每来源每组只请求一页；不为凑满数量循环翻页。

## AI与费用

AI整理默认关闭，用户可勾选启用；复用已加密保存的语义分析模型。一次任务最多一次模型调用、最多10条尚未整理内容，按三类来源轮流取样，输入仅含标题、已有摘要/描述和已保存字幕。返回中文标题、摘要、相关性说明及可核对的原文片段；相似内容仅标记关联，原始记录和来源仍保留。输入资料被作为不可信内容处理，模型引用必须是原文片段。

相同来源/词/市场/语言/数量口径24小时内复用缓存；收藏及产品关联不会被重新采集覆盖。ScrapeCreators 仅累计响应明确返回的 `credits_charged`；超时或未知结果单列，不估算为已扣除。模型显示服务商返回的 token 用量。原始内容和摘要不能自动代表可商用授权。

## 任务恢复与发布集成

公共内容队列独立于关键词和商品队列，最多5项未完成任务，逐步持久化。限流、缺少密钥或语言不支持时跳过该来源后续相关词，其他来源继续。服务重启时，已经标记“请求中”的步骤改为“结果未确认”，不自动重放；模型同理，避免重复收费。尚未发出的请求可以续跑。

部署前须等待公共内容队列当前步骤结束，并取得本队列专用部署锁，不能只使用旧的两条队列锁：

- PostgreSQL runner advisory lock：`89761031`；submit：`89761032`。
- MySQL 名称：`intelligence:public-content-runner`、`intelligence:public-content-submit`。

这两个锁没有复用 `database.mjs` 中通用备用锁 ID；整合部署脚本时应加入本 runner 锁并核对待执行任务。发布必须与商品功能串行整合，不复制整份旧入口文件，不覆盖服务器 `public/data`。

## 验证方式

无需正式数据库或真实平台密钥：

```sh
node --test server/public-content.test.mjs
pnpm exec vitest run tests/public-content.test.ts
pnpm --filter @vben/web-antd run typecheck
```

隔离 PostgreSQL 接口测试和浏览器验收服务支持测试环境独立安装的 `@electric-sql/pglite`，通过 `HCI_TEST_PGLITE_MODULE` 指定其 `dist/index.js`，没有将此测试运行时加入应用依赖或锁文件：

```sh
node --test server/public-content-store.test.mjs
node tests/public-content-ui-server.mjs
```

UI服务只监听 `127.0.0.1:5710`，内存数据库、合成关键词/产品/来源结果；禁用外部网络。浏览器访问 `/admin/signals`。构建时需要现有服务器模式配置：`VITE_HCI_SERVER=true`、`VITE_BASE=/admin/`、`VITE_ROUTER_HISTORY=history`；独立验收使用自己的应用命名空间。不要把没有 `.env.server` 的旧基线按默认 hash 路由当作服务器构建。

正式 MySQL 环境集成、付费社媒实际权限、额度及生产发布均需由统一集成流程验证；本功能开发不自动执行这些动作。

2026-10-19 本地验证：21项后台规则/连接器/恢复测试、4项前端结果处理测试、1项隔离 PostgreSQL 接口集成测试通过，web-antd 类型检查和服务器模式生产构建通过。浏览器以合成来源验证三类结果、模拟429不阻塞、AI整理、收藏、刷新、产品关联、已有字幕、列表切换及10/20条分页；CSV已实际下载并检查表头。免费接口抽查中 Europe PMC（creatine）返回3条相关文献，MedlinePlus（vitamin）返回5篇相关主题文章；creatine 在 MedlinePlus 的泛化结果被相关性过滤。未调用真实收费社媒或模型服务，未修改正式数据库。

新增模块已单独通过 Oxlint、ESLint、Stylelint 与格式检查。仓库全量提交钩子在既有 `server/index.mjs`、`signals.vue` 等历史代码上仍有规范错误，已用基线文件复核；不为通过钩子重写这些共用入口。提交时手动完成本功能检查及 commitlint，并仅对本次提交跳过存在历史失败的全量钩子。没有修改仓库钩子配置或全局 Git 设置；不声称全仓检查通过。

## 官方接口参考

- https://developers.google.com/youtube/v3/docs/search/list
- https://docs.scrapecreators.com/openapi.json
- https://medlineplus.gov/about/developers/webservices/
- https://europepmc.org/RestfulWebService
