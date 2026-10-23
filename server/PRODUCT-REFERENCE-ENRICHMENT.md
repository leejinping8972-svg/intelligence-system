# 商品中文参考、公开上架日期与销量补全

## 交付状态与入口

本功能基于已确认的 testing 提交 72d26c80a046c6355df481c3e392f931033ff60e，在独立分支 codex/product-reference-enrichment-20261023 开发。代码及本机合成验证完成，待集成；未执行正式补全、真实付费调用或正式部署。

商品库的“补全商品数据”覆盖当前筛选的全部记录，详情“补全此商品”处理单件。打开弹窗先调用 server_preview_product_enrichment，只读取所选商品并显示来源数量、预计请求数及默认上限；用户提交后沿用 server_complete_platform_products、持久任务及请求 journal。官网无需 Sorftime 凭据，Sorftime 商品仍复用既有详情/属性/当前 ASIN 历史能力。

## 中文参考

- 原标题保持原样；列表、卡片、详情和对比增加中文参考，CSV 增加同名列；前端与后台检索采用相同函数。
- 优先使用已有 titleZh；否则按本地成分词典生成阅读参考，保留品牌、未知专有词、剂量和包装。截图五个标题已覆盖。
- 不调用翻译服务；无法识别的标题显示“中文参考待补充”。不是全库逐条人工翻译，也不将参考名称当作官方中文商品名。

## 来源与口径

- 官网只从原商品精确 URL 的匹配 Product JSON-LD、嵌入的 Shopify 商品 JSON 或同源相同 handle 的 /products/handle.js 提取字段。
- 上架日期只接受 published_at、datePublished、releaseDate，校验日历和未来日期，保存原字段、原日期、URL 与核验时间；采集时间、创建/更新时间与首次发现均不能替代上架时间。
- 累计已售只接受 numberOfItemsSold、soldCount、sold_count 的非负安全整数；有单位和周期时必须匹配件数和累计口径。0 是有效值，评价数、订单数、金额、月销量、区间和近似值不填到累计销量。
- 官网未披露、请求失败、字段冲突和预算截断分别展示。没有可靠来源时保留未知；已有日期/销量不会被空返回或失败清空。
- 官网上架日期/销量与 Sorftime、平台月度销量分开保留，不能跨商品、跨平台或跨周期套用。
- 正常官网采集同时保存公开日期/销量及来源字段；生成的 collector.js 与源码 helper 的行为有专项对照。

## 任务与数据保护

- 单件官网补全最多2次读取（重定向包含在内）；整批共用手动上限，默认 min(150, 预计次数)，至少1。每步先持久预留，确认实际次数后释放差额；未知结果不释放预留。
- 同一域名任务内间隔30秒，429或401/403后跳过本批同域名后续商品。只允许保持同域名、同路径/查询的安全跳转，不跟随跨商品重定向。
- 复用既有安全公开读取（DNS/私网、响应大小、类型、超时保护）、提交幂等和 durable journal；丢检查点重跑复用已保存请求结果。取消后不发起剩余读取；删除商品不会被补全补丁复活。
- 保留收藏、审核、首次发现、站点/关键词关联及历史。publicDataEvidence 保存字段核验状态，sourceMetrics 和 decisionData.listing 保存真实观察值。
- public 计数按尝试保守计入；DNS预检失败可能计1次但没有实际HTTP发送。平台已有请求/额度语义沿用原实现，未扩大授权。

## 集成事项

- 无业务 schema、依赖清单、锁文件或数据库迁移。
- workspace-reads 派生版本为 workspace-reads-v6-product-reference；集成时保留其他功能字段并按发布流程预热新版本，中文检索和旧商品摘要不能以旧索引验收。
- 共用入口包括 products.vue、ProductDrawer.vue、ProductCompletionDialog.vue、data.ts、core-list-metrics.ts、product-decisions.ts；server/index.mjs（只新增预览 action）、platform-products-jobs/provider、platform-product-completion/data、workspace-reads、product-jobs/queue、core-evidence、collector.ts/js、model.js；worker 商品解析；testing.yml 专项追加。必须用 Git 合并，不覆盖整份共享文件。
- 上线本身不会自动读取全库官网或触发收费任务；真实补全仍由用户在正常入口按预算提交。实际可补全比例取决于官网披露及来源权限。

## 本机验证（2026-10-23）

- 107项 Node 专项和相关回归通过（中文词典、官网提取、平台补全/队列、列表字段和 worker）；最后预算修正相关24项复验通过，不能将复验重复累计。
- PGlite 隔离真实 SQL 8项通过：预览/提交幂等、无链接原因、1次预算、精确来源与人工状态保留、中文检索/日期区间/导出、近期结果复用与空刷新保留、取消/删除保护、同域429停止；最后预算原因断言复验通过。
- 45项前端指标、中文组件与商品决策测试通过；完整 web-antd 类型检查及 server/history 预览构建通过，产物在本功能树 .artifacts/frontend。
- 内置浏览器默认1280×720合成页面：列表/卡片/详情中文参考、中文检索、来源弹窗、缺失/失败原因、默认预算与手动3次预算提交后导航到任务页通过；页面无文档横向溢出。截图与模拟提交回执在 .artifacts。未测试真账号、MySQL8、远端CI或手机断点。
- 新增中文模块/组件/测试及指标测试专项 ESLint、5个新增模块默认规则 Oxlint、diff 和 commitlint 通过；不声称全仓历史 server lint 通过。
- 合成来源验证外部HTTP调用0、付费调用0、正式数据写入0；浏览器只调用本机模拟API，未以模拟销量或日期宣称真实商品已补齐。

复现隔离测试：设置 HCI_TEST_PGLITE_MODULE=./server/node_modules/@electric-sql/pglite/dist/index.js 后执行 node --test server/product-reference-enrichment.integration.test.mjs。其余专项已追加到 testing.yml；远端CI未运行确认。
