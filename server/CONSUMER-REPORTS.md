# 消费者洞察报告与 AI 配置

## 页面与入口

- 入选关键词：单词或勾选 1～20 词生成，每词独立报告、保留自身市场；表格直接展示最新报告的前三个话题、引用文本数/样本占比和状态。
- 消费者需求洞察：保持分页列表，支持关键词、热门话题、搜索、审阅状态和全局市场组合筛选。服务端先筛选再分页；关键词最新摘要不受原来的 200 份历史报告限制。
- `/consumer-insights/reports/:id`：独立详情，以话题/热度、建议、来源表为主；原文按需展开；保留审阅、Word/原始数据导出、已有证据再次分析。旧 `?report=` 链接自动转新页面。
- `/ai-config`：管理员统一管理模型接口及消费者报告、广告报告、公共内容中文整理、关键词中文名称四类提示词；设置页保留入口。广告旧配置入口共用原来的存储和版本。

## 来源、预算与口径

- 默认 Reddit 按关键词发现帖子，可显式同时取样 1～5 个讨论帖的评论。新弹窗默认每词 5 次采集请求、每来源 1 页、200 条文本；每次提交前展示批量份数、请求上限和是否另调用一次模型。
- 也可使用 Reddit 帖子、YouTube/TikTok 视频、Facebook 公开原帖/Reels 的 HTTPS 链接采评论。广告需公开原帖；文章需受支持平台的讨论/分享帖链接。没有实现任意网站文章评论抓取，也不把正文、广告文案当消费者评论。
- Facebook 固定 `/v1/facebook/post/comments`，传 `url`/`cursor`；按官方 OpenAPI 的 `comments[].text/created_at/reaction_count` 解析，不读取作者资料。2026-10-21 仅核对公开元数据，未作真实收费调用。接口参考：[官方 OpenAPI](https://docs.scrapecreators.com/openapi.json)。
- 所有采样共用原任务请求/页数/文本上限；评论断点独立保存在原 checkpoint，通过原 request journal 防止重放，失败不自动重试。旧队列未携带 `autoComments` 时不扩采；旧消费者任务没有提示词快照时沿用旧提示词。
- 热度为规则命中或 AI 引用文本数 / 相应样本数；话题可重叠，非搜索量或全平台热度。模型不提供计数，系统仅从有效证据编号计算。模型最多分析 80 条，按讨论来源分配样本并优先评论；报告区分 AI 样本与全部采样。
- 逐词提交保留唯一 requestId；部分失败后仅重试未确认项，表单冻结并复用原编号，已提交词不重建。继承后台 20 个活动任务上限，达到时保留已成功项并提示。

## 提示词与兼容

- 新增 `provider:ai-prompt:<key>:v1` 配置文档；广告继续 `provider:ad-report-prompt:v1`。无数据库结构迁移、无依赖变更、无新增 runner 或发布锁。
- 管理员保存使用版本比对及原数据库 advisory lock；固定 JSON/证据契约不可从编辑界面覆盖，仍执行输出校验。
- 消费者和广告报告在提交时快照提示词，运行或重启不改用后续配置；公共内容在实际整理时、关键词在显式翻译时读取当前配置并记录版本。修改配置不调用模型，不自动重新生成历史报告。
- 旧报告在只读详情中按已存证据补算话题展示；列表可回退到已存规则/模型结果，不重采、不写回业务记录。新报告排队时即保存关键词关联。

## 验证与集成

- `node --test server/consumer-reports.test.mjs server/research-insights.test.mjs server/keyword-names.test.mjs server/ad-report.test.mjs server/public-content.test.mjs server/public-content-enrichment.test.mjs`
- `pnpm exec vitest run tests/consumer-reports.test.ts tests/report-cache.test.ts tests/report-document.test.ts tests/public-content.test.ts`
- `consumer-reports.integration.mjs` 挂在既有 guarded `competitor-monitor.integration.mjs` 的末尾，复用隔离 PostgreSQL/MySQL 夹具；只使用合成配置与数据，测试提交幂等、市场校验、提示词持久化/版本冲突/快照、组合筛选和超过 200 份报告。
- `tests/consumer-reports-ui.mjs` 使用本机模拟 API 及浏览器，验证批量失败重试、摘要、筛选、独立详情、原文、窄屏和四类提示词保存。外部网络全部拒绝。
- 共用入口：selected-keywords、consumer-insights、settings、路由、research-reports 类型；index 分派两项 AI 配置动作；insight-jobs 提交快照/摘要筛选/评论取样；model-provider 的消费者采样/提示词；keyword-names 与 public-content-store/engine 接配置及版本；research-evidence 加 Facebook 解析。CI 追加专项，既有 Docker 通配复制自动包含新服务模块。
- 功能会话不推共享 testing、不部署正式。真实来源权限/扣费、模型生成质量以及准确候选的 Docker/MySQL CI 需后续集成核验；本机测试不使用正式密钥或业务库。
