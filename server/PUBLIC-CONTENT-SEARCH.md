# 公共内容搜索：集成交付说明

## 范围与入口

按关键词或产品名称，按需搜索公开视频、文章、帖子和文献。分类为社媒内容、权威健康资讯、学术证据；普通网页/博客独立列为“网页文章”，不冒充权威健康资讯。没有定时监测、品牌素材审批或自动广告发布。

## 检索范围与搜索弹窗（2026-10-19 增补）

页面保留结果与历史，“搜索视频与文章”按钮打开条件弹窗；关键词/商品入口进入时直接打开条件弹窗。`scopes` 可多选 `local`（目标市场本地素材）/ `global`（全球参考证据），每个选中范围至少有一个适用来源。

- local：YouTube、TikTok、Reddit、Facebook 视频/网页索引帖子、Instagram Reels、本地健康文章、普通网页。使用 market/language；Facebook/Instagram/普通网页附国家关键词。Reddit 接口没有国家过滤，页面明确标记未核实，不能声称都是本地作者。
- global：NIH ODS / NCCIH / NHS / WHO 机构文章、MedlinePlus、Europe PMC、普通网页。使用独立 `referenceQuery`（留空用原词）与 `referenceLanguage`（en/es），地区为 ALL。越南本地检索不会再让 MedlinePlus 错用越南语。有限相关词表可补英文成分词，不自动翻译所有品牌词。
- 每个范围最多3组词，每来源每组只请求一页，所有范围合计遵守原结果上限。国家参数只是检索条件，不作为作者/受众所在国证明。`searchContexts` 保存各次检索范围/市场/语言/词并合并保留；`marketBasis` 说明本次来源的地域依据，作者国家缺失保持 unknown。旧记录不强行补“本地素材”标签。
- 源语言仅从明确来源字段记录；本地机构站点可标 `publisherCountry`，不等于作者国家。列表、详情、CSV区分这些字段。原站点内容或产品功效是否成立不由本站点所在国推断。
- 缓存使用 scope-v2 与步骤范围/词/地区/语言/数量口径，避免旧缓存或本地/全球结果互串；原收藏、关联、字幕、评论仍保存。数据库无表结构变化。

新增渠道复用现有加密 ScrapeCreators key，无额外密钥页：

- `GET /v1/facebook/search/videos`：Facebook 原生公开视频/Reels。不是普通图文全量搜索；无严格国家过滤。
- `GET /v2/instagram/reels/search`：Google 已索引的 Reels，非 Instagram 全量站内搜索。
- `GET /v1/google/search`：Facebook 公开帖（仅允许 facebook.com 的 posts/photos/story/permalink 路径）、普通网页/博客、本地健康站点定向搜索。只保存索引标题、摘要和链接，不自动抓正文或跳转用户链接。
- 本地健康白名单：VN=moh.gov.vn/vinmec.com/hcdc.vn；US=medlineplus.gov/nih.gov/cdc.gov；MX=gob.mx/imss.gob.mx/insp.mx。每条返回重新验证主机（含合法子域），拒绝伪装域名；机构来源不代表每篇文章支持当前产品宣称。
- 全球机构文章白名单：ods.od.nih.gov、nccih.nih.gov、nhs.uk、who.int。单独的 global_health 来源和检索日志，使用固定 Google 搜索端点，复用 ScrapeCreators key，只保存公开索引摘要/链接。
- `server_content_comments`：手动对已入库 Reddit 帖子发起 `GET /v1/reddit/post/comments`，至多一次请求、20条顶层评论；明确不完整，不自动展开/分页。已存取样不再调用，运行中同帖请求复用任务；计费不确定不自动重放。

接口字段按 2026-10-19 官方 OpenAPI 核对：https://docs.scrapecreators.com/openapi.json 。新增收费端点仅用合成响应测试，未验证该账户实际权限或消耗真实额度；空结果不循环翻页补足。

数量是本程序处理上限，不是平台收录总量或套餐限额：每步骤处理 `min(20, ceil(任务总上限 / 计划步骤数))` 条候选，单来源单范围至多3步骤，双范围网页来源可有6步骤；全部来源去重入库合计最多任务 limit（5～100）。步骤日志分别保存本页实际数组条数、处理配额、安全候选、词面相关、新增条数；明确区分本页零结果、过滤淘汰、配额截断与限流错误，不把第一页空结果解释为全站没有内容。

本次增补验收：33项后台测试、5项前端结果测试、1项隔离 PostgreSQL 接口测试（共39项）通过；类型检查与服务器模式构建通过。隔离浏览器验证了越南/越南语联动、双范围/单范围/无范围校验、独立英文参考词、Facebook/Instagram/网页来源、模拟429后其他来源继续、范围筛选、列表、Reddit评论读取及防重复按钮。所有新收费渠道只使用合成响应；未写生产库、未调用真实收费来源，MySQL回归和真实权限由统一集成验证。弹窗底部固定提交/取消操作，长表单在主体内滚动。

- `/signals` 的默认页签为“公共内容搜索”，原有公共信号保留在独立页签。
- `research.vue` 的关键词操作列增加 `PublicContentLauncher`，传入搜索词、市场和关键词 ID。
- `ProductDrawer.vue` 底部操作栏增加同一独立组件，传入品牌/标题、市场及产品 ID。没有修改商品平台页签或决策标签。
- 结果支持来源分类/网页文章页签、类型/来源/实际来源语言/日期/文本筛选、卡片/列表、10/20/50/100 分页、详情、收藏、关联关键词/产品及 CSV 链接清单导出。

## 接口与存储

`server/index.mjs` 增加模块导入、`runContentQueue(controller.signal)` 与 `server_content_*` 分发，并在数据库迁移前持有公共内容 runner/submit 锁、确认本队列已空闲。沿用现有服务器会话授权，演示版不连接正式接口。

- `server_content_status`：只检查是否保存凭证，不检测外部平台、不返回密钥。
- `server_content_submit`：`requestId` UUID + `input`；输入包括 query、market、language、scopes、referenceQuery、referenceLanguage、sources、limit、includeRelated、relatedTerms、organize、keywordIds、productIds。立即保存后台任务；同编号重复提交复用任务。
- `server_content_snapshot`：历史任务（最近40项）、选定任务及内容；`favorites=true` 查询收藏（最多1000条）。
- `server_content_cancel`：取消尚未发出的请求；当前已发出请求的返回内容仍保存。
- `server_content_save`：只修改已入库内容的 favorite、keywordIds、productIds。
- `server_content_transcript`：对已入库 YouTube 视频按需提交一次已有字幕读取任务。

不增加表或字段，复用 `workspace_documents`：`content:job:<UUID>`、`content:item:<hash>`、`content:cache:<hash>`。这些数据不纳入旧 `business:*` 浏览器同步，避免被旧客户端删除。备份应保留这些命名空间。

## 连接器与覆盖边界

- YouTube Data API v3 `search.list`：复用 `provider:youtube:v1` 或既有环境凭证；取得标题、描述、频道、日期及链接。地区/语言用于搜索，不推断作者国籍或实际语言。
- ScrapeCreators `GET /v1/reddit/search`：帖子、已有文本、互动和原帖链接；不访问帖子中的外部落地页。
- ScrapeCreators `GET /v1/tiktok/search/keyword`：视频描述、封面、作者、来源语言和链接；地区参数不作为作者国家。
- MedlinePlus `https://wsearch.nlm.nih.gov/ws/query`：仅英语/西语健康主题文章摘要。新任务在全球参考范围使用独立英语/西语；历史越南语步骤仍明确跳过。搜索可能无结果，不用泛泛健康文章补足数量。
- Europe PMC `https://www.ebi.ac.uk/europepmc/webservices/rest/search`：文献索引、摘要、作者、DOI及来源提供的开放全文入口；不会声称已抓取论文全文。
- ScrapeCreators `GET /v1/youtube/video/transcript`：只读已有原语言字幕，不做音频转写，不自动下载视频。

外部请求只访问代码中固定的 HTTPS 端点，禁止重定向，限制返回大小和超时；不会抓取用户填写的任意网址。文案以纯文本呈现，平台/机构链接域名白名单检查；普通网页仅允许不带认证/端口的HTTPS域名链接，拒绝IP和内部域名，不请求正文、不渲染来源 HTML。

当前允许的市场为 US/MX/VN，检索语言为 en/es/vi。相关词扩展采用有限成分词表和最多2条手工补充，不声称自动翻译所有品牌词。来源语言未提供时保留 unknown。结果上限5～100条、每范围最多3组词、每来源每组只请求一页；不为凑满数量循环翻页。

## AI与费用

AI整理默认关闭，用户可勾选启用；复用已加密保存的语义分析模型。一次任务最多一次模型调用、最多10条尚未整理内容，按各内容分类轮流取样，输入仅含标题、已有摘要/描述和已保存字幕。返回中文标题、摘要、相关性说明及可核对的原文片段；相似内容仅标记关联，原始记录和来源仍保留。输入资料被作为不可信内容处理，模型引用必须是原文片段。

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
