# 入选关键词每日广告/商品发现

功能分支基于 testing/正式 `05ba05ccc42cdaa3e2fbaa19121c2801277dd7f2`。功能开发交付，不代表已合入testing或上线。

## 使用

“已入选关键词”“广告观察”“新品雷达”均可打开“每日发现计划”。仅管理员可保存；其他研究员可查看记录。默认关闭，北京时间09:00；启用时须设置有限预算并确认使用已有来源额度，不购买额度。

每天到点读取所选市场的全部非演示入选词，不受前端勾选、搜索、分页影响。当天批次固定关键词和设置；当天新增入选词、预算/时间/来源调整从下一天生效。执行前再检查关键词仍入选、市场和词文本未变；排队商品任务每步再检查。取消入选不再调用后续步骤。

同一天最多一个批次，错过执行时间时服务器恢复后执行当天批次，不补跑往日。暂停停止未排队的步骤，已提交的任务继续，可在任务中心取消。暂停后同一天重新启用不会重建已跳过的步骤，避免无意重复付费。

## 来源、预算和执行

- 广告：ScrapeCreators/Meta，查询ALL状态，按每词页数预留请求；只采广告，不额外核验落地站或调用站点Semrush指标，也不自动分析文案/字幕。
- 商品：Sorftime/Amazon（US/MX）及Semrush/Google Shopping（US/MX/VN）；VN剔除Sorftime，不跨市场替代。每词每来源分别限制条数，Semrush最多1个广告商域名。每日只发现商品，不默认重采全部商品详情/销量趋势；这些仍通过商品库补全入口运行。
- 每词预留广告maxPages次；商品Sorftime 1次、Semrush 2次；Semrush保守预留 `20 + 30 × perKeyword` units。每日广告请求、商品请求、Semrush units均有正数上限。元数据工具查询不计为数据请求次数，来源实际计费仍以返回回执为准。
- 预算为每日批次预留上限，不能保证返回目标条数；不足的词/来源明确标记“未执行”和原因，不静默截断。每日按固定哈希轮换词序，降低有限预算一直覆盖同一组词的问题。已有手动任务与商品补全预算独立，不计入此计划；跨日排队任务仍归原批次预算。
- 同时最多一个每日子任务在队列中，避免大量排队后才发现来源问题。遇到鉴权、限流、额度异常或未知扣费时，停止当日该渠道后续自动请求；另一渠道可继续。手动任务占用同一词或队列满时60秒后重试提交，不自动重放来源请求。

## 幂等、数据与标签

`discovery:daily:plan`保存计划；`discovery:daily:run:YYYY-MM-DD`保存冻结输入、预留和每步稳定requestId、jobId、状态、原因。requestId由日期/渠道/关键词ID产生，与设置修改无关。先存批次再提交现有队列；进程中断后通过requestId恢复，沿用现有research_requests请求journal保护。每日平台发现缓存追加日期，手动/详情历史缓存签名保持原样。

广告/商品保存在现有 `business:ads:*` / `business:products:*` 文档，通过既有工作区同步进入广告、商品库及新品雷达，不另建一份雷达业务副本。`discovery`保存首次/最近真实观察、最近90个观察日期及规则判断快照；重放相同回执/缓存不增加观察日期、不刷新首见。保留关键词关联、人工收藏、审核及已有补全数据。浏览器业务同步不可覆盖服务器观察记录和来源日期；导入不能伪造观察元数据。

统一规则 `discovery-newness.mjs`（前后端共用，纯函数）：

- 商品：有来源、平台、同市场和证据网址的有效上架日期，且采集时间不在未来；上架不超过90天标新品，超过则非近期新品。并不代表品牌首发。
- 广告：有来源及证据网址的投放开始日期，不超过7天标新广告，超过则非近期新广告。
- 缺少/无效/未来日期或来源不足保持“待核验”；单纯首次发现不能证明新上市/新投放。网页显示时按当前日期重新评估，避免旧快照永远保持“新”。
- “近期新发现”独立标记系统首见，不与来源新旧混同。广告和商品都支持新旧标签筛选。
- 雷达增加新广告类型、统计、证据和跳转广告详情，商品沿用既有候选入口；已知旧上市/投放日期不进入新增候选。缺失/无效/未来首见日期不再回退为今天。官网公开采集候选也采用相同日期规则。

## 集成与验证

新模块：daily-discovery-domain / daily-discovery / discovery-newness，前端DailyDiscoveryPlan / DiscoveryTag / discovery，以及专项测试。共享入口是server/index（两个计划动作及观察字段保护）、runner（在普通runner锁内调度及任务名称）、database（独立每日提交锁PG `89761033` / MySQL `intelligence:daily-discovery`）、market/platform商品合并/提交/执行、平台缓存及官网商品观察时间；前端ads/products/radar/selected-keywords/data和ProductDecisionTags；CI增加专项命令。无生产数据迁移、无依赖/锁文件改动。

调度只在普通runner持锁期间执行，原发布冻结runner即冻结自动排队；没有额外常驻调度进程。合并时保留市场切换任务对同页的独立修改，不复制整份页面。

测试命令：

```sh
node --test server/daily-discovery.test.mjs
# 可选独立测试运行时，不加入生产依赖；指定已安装的PGlite dist/index.js
HCI_TEST_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test server/daily-discovery.integration.test.mjs
pnpm exec vitest run tests/discovery-radar.test.ts tests/product-decisions.test.ts
pnpm --filter @vben/web-antd run typecheck
```

本功能自测使用合成来源/内存PostgreSQL，没有连接正式库或调用真实收费来源。正式MySQL和来源账户权限由独立集成发布会话验证，不能把本机PGlite通过等同于正式MySQL通过。上线后需管理员显式启用计划；本次功能开发没有启用正式自动任务。

2026-10-20交付验证：98项后台测试（含1项PGlite真实提交/持久化/恢复/暂停/次日验证）及32项前端测试，共130项通过；web-antd类型检查与服务器/history模式构建通过。浏览器12项交互验证通过：计划加载/启用/额度确认/保存、390px无横向溢出且操作栏固定、三类广告标签与筛选、商品标签、雷达排除已知旧广告、证据与广告详情跳转，页面错误0。截图在本worktree `.artifacts/daily-{plan-desktop,plan-mobile,ads,radar}.png`，QA浏览器/HTTP服务已关闭。

新增模块Oxlint、两个新组件ESLint/Stylelint、雷达新增样式、diff及commitlint专项验证通过。沿用协调记录中的一次性hooksPath处理历史全仓钩子问题，不修改仓库或全局钩子，不声称全仓lint/所有历史测试通过。现有product-decisions新品规则升级v3，与统一新旧判断共用来源日期/证据校验；保留全部原趋势标签规则，避免商品页与雷达口径冲突。
