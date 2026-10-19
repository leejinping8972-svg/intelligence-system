# 商品决策标签 v1

本模块提供可解释的标签，不给未知指标打分，也不将搜索热度、广告数量或排名变化等同于商品销量。

## 接入约定

商品保留现有字段，额外字段均为可选：

- `sourceProvider`：Sorftime、Semrush 等数据提供方。
- `sourcePlatform`：Amazon、Google Shopping 等原始平台。
- `sourceProductId`：平台商品标识；ASIN 必须与国家市场组合使用。
- `sourceUrl`：原始记录链接。
- `decisionData.listing`：有来源的上架日期，含 `date/provider/platform/market/collectedAt/evidenceUrl`。
- `decisionData.series[]`：独立的商品指标时间序列，含 `provider/platform/market/productId/metric/period/collectedAt/evidenceUrl/points`。

`metric` 为 `sales_volume`、`sales_rank`、`shopping_rank` 或 `keywords_count`；`period` 为 `day`、`week` 或 `month`。每个点的 `start` 和 `end` 都是来源时区对应的日期（YYYY-MM-DD，包含首尾日期），`value` 为非负数，未结束周期标记 `partial: true`。上游须先验证指标属于同一具体商品；不得因同品牌或相似标题自动复制到别的规格。

这些字段通过现有业务文档同步保留；标签在读取时计算，不会改写第三方原始指标。旧记录无指标时显示“趋势待补充”。仅用户提交平台采集任务时调用现有凭证与额度，本模块不自动发起收费采集，不自动把已有官网商品匹配到 Amazon ASIN，也不为缺失时间序列生成虚构历史。

## 规则

- 新品：可追溯的平台上架日期在最近90天内（含第90天）。未来日期、缺少来源、国家不匹配的日期无效。不代表品牌首发。
- 首次发现：系统首次观察在最近14天内，单独标记，不代表新品。
- 近期增长/回落：最近两个相邻完整周期销量指标变化 >=20% / <=-20%。前期销量指标小于20的正增长单独标记“低基数增长”。
- 持续增长：满足近期增长，且最近四个完整周期连续上升、最早销量指标至少20。
- 新出现信号：至少三个连续完整周期指标为0，最新周期为正；不计算零基数百分比。
- 偶发尖峰：至少三个前期周期的中位数 >=20，之后峰值 >=中位数的3倍，随后两个周期均回落到中位数1.5倍以内。没有峰后观察时不提前认定尖峰。
- 排名改善/回落：排名数字变化 <=-20% / >=20%；排名0无效，不解释为销量变化。
- 搜索覆盖扩大/缩小：商品覆盖关键词数变化 >=20% / <=-20%，不解释为销量或点击变化。
- 非完整月、重复时间桶、缺失中间周期、非有限数值、负值不参与比较。来源、平台、市场和商品不同的时间序列不拼接。
- 日/周/月序列最新数据超过7/21/45天时显示过旧，不作为当前趋势。

## 界面与验证

商品卡片、列表及详情抽屉复用同一标签模块。点击任何标签可看来源、周期、数值、判断理由和采集日期；键盘和触屏都可操作。列表支持按决策标签筛选，CSV 附带标签及依据。

测试：`pnpm exec vitest run tests/product-decisions.test.ts --environment node`，另运行 web-antd 类型检查和生产构建。

## 并行开发

共同基线：`a6643aa305ebe931d30897580f7e26d92c04cdd9`。
本功能分支：`codex/product-decision-tags-20261019`。
本功能目录：`D:/项目代码/Intelligence_System/_worktrees/product-decision-tags`。

公共内容搜索功能使用独立 worktree。`data.ts`、`ProductDrawer.vue` 等共享入口通过提交合并解决，不能复制整份旧文件覆盖。构建产物各自留在各自目录。上线由同一集成人按顺序进行，并保留线上 `public/data`；不得并行覆盖服务器目录。

## 平台采集流程

商品情报库的「按词获取平台商品」、已入选关键词的同名入口 → 选择同一国家和数据源 → 后台 `platform_products` 任务 → 来源内去重与关键词关联 → 初筛后补详情/素材/当前ASIN历史 → 商品标签。

- Sorftime MCP：`product_search_from_name`（query_type=2，每页20；最多5页）→ 标题/副标题按关键词过滤 → `product_detail`（已有上架日/评分时跳过）、`product_content`、`product_trend(type=AsinSalesVolume)`。只对配置数量的匹配商品补全，不调用独立站爬虫。当前支持Amazon US/MX；不将别国数据替代越南。
- Semrush MCP：`get_report_schema`检查权限和字段 → `phrase_adwords`查相关广告商域名 → `domain_shopping`按关键词筛选Google Shopping商品。尚未承诺工具能直接按词无域名返回完整商品。部分PLA URL是商家首页，因此用市场+来源+URL+标题区分记录，并显示索引快照日期和SKU未核验提示。
- 每个商品保留 provider/platform/market/productId、发现关键词、来源链接、采集日期。Amazon以ASIN+市场去重；不同来源同名商品不自动合并，避免错配规格。
- 图片、属性、描述按平台真实字段保留；Special Ingredients只是属性提及，不充当完整配方。没有每份剂量、评论正文或销量历史就显示未知，不由模型猜填。
- 历史仅取明确当前ASIN的月销量；`-1`、未结束月份不参与增长计算，不把基础资料的月销快照拼成历史。平台不返回历史时显示“趋势待补充”。

## 预算、缓存和恢复

- 后台队列每轮处理一个步骤，保存检查点后让出调度；停止浏览器不影响服务器执行。
- 用户可设全局商品数、每词每来源商品数、请求步骤数、Semrush units预留和补全数量。请求上限不足以覆盖全部关键词基础发现时拒绝提交，不默默丢词。
- 来源搜索/趋势缓存24小时，详情/素材7天；命中共享缓存返回原始日期，缓存结果不伪装为新数据。
- Semrush当前预留参考小样本已确认的20 units/广告商报告行、30 units/PLA行。真实返回用量单独累计；不将预留当成最终账单。费率或权限可能变化，返回用量超预留时扣减后续额度。未知用量单独提示，不自动购买额度。
- 请求启动前写journal；完成结果可在重启后复用。结果未知或失败的可能收费请求不自动重放，保留错误并继续其他对象。鉴权/限流/字段结构错误停止该来源的后续请求，其他来源继续。
- 重复提交编号返回同一任务；并行相同市场/关键词任务拒绝重复；取消保留已入库结果。
- 刷新保留收藏、审核、首次发现与历史；旧浏览器业务同步只允许修改平台商品的人工状态，不能覆盖后台新采指标。关键词重新评分保留已建立的商品关联。

## 验证记录（2026-10-19）

- 1个真实词 `creatine gummies` / US：Sorftime搜索20条中含不相关商品，已增加相关性过滤。素材有图片和属性；ASIN B0DCC4R4Q5 历史为空，不生成增长判断。3次Sorftime产品调用，未报告扣分数量。
- Semrush广告商报告2行确认40 units；1条PLA确认30 units，共70 units。实际商品可能指向HTTP商家首页，保留来源而不当成精确商品URL；索引快照与当前采集时间分开。
- 真实取样未写入正式业务库。后续单元/数据库/页面测试使用模拟提供方，不新增收费调用。
- `node --test server/platform-products.test.mjs server/semrush.test.mjs server/product-queue.test.mjs server/job-progress.test.mjs`
- `pnpm exec vitest run tests/product-decisions.test.ts`
- `pnpm --filter @vben/web-antd run typecheck`，VITE_HCI_SERVER=true 的独立生产构建。
- `server/platform-products.integration.mjs` 仅允许 `PLATFORM_PRODUCTS_QA=disposable-only` 和固定隔离主机/库名；每次新建空的MySQL8或PostgreSQL17容器。数据库网络使用 `--internal`、不发布端口、不读取生产密钥，提供方全部模拟；测试提交幂等、双来源入库、关键词关联、人工状态、历史保留、取消和请求journal恢复。运行后删除临时容器/网络。
- 旧 `server/integration.test.mjs:81` 在未修改基线也失败：旧断言期望同步3请求，与已有异步趋势调度（1次）不符。未把这项写成通过。

代码完成与上线分别记录；本分支尚未合入GitHub测试分支、未发布正式服务器。
