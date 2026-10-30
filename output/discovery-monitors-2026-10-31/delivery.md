# 新品监控、来源字段分析与成分研究

状态：功能开发完成，待集成。未合入或推送 testing，未正式部署，未启动生产监控。

## 交付范围

1. 新建监控支持「每周监控1 · FBM新品」：默认周一北京时间09:00，近7天、Amazon且明确FBM的保健品，AI确认保健品身份后入库。
2. 「每周监控2 · 常规新品」默认相同周周期，涵盖账户实际开放的6个商品渠道：Amazon、TikTok Shop、Shopee、Temu、Walmart、1688。各渠道来源站点可分别选择，保留来源市场与归档市场，避免把越南Shopee或中国1688当作美国数据。
3. 商品库「从平台获取商品」新增「新上架保健品」，支持近7/30/60/90天、渠道多选。7天结果记录新品分类；更长范围标记「新上架商品」，保留上架日期和来源证据。
4. 商品、独立站、广告的采集入口保留原始资料，语义字段经AI分析及原文引用校验后写入。Special Ingredients不再充当完整配方；Serving Size不再充当成分剂量。缺失或无有效引用的字段保持未知。所选历史记录可通过「AI整理字段」重新分析，未自动批量改写历史数据。
5. 监控与任务提供统一「新建监控」，包含现有独立站、广告主、每日发现、热词、关键词趋势、市场采集及商品监控入口。新监控可保存、编辑、启停、删除，任务及结果独立保留；原有商品监控仍沿用既有实现。
6. 找方向新增「成分研究」：Reddit帖子和评论、Quora问题和回答，经AI提取成分并保留引用、日期、链接；支持话题、讨论时间范围、每天/每周/每月和执行时间。默认每天09:00，首次发现指本系统首次记录，未宣称全球新成分。

## 执行与数据保护

- 默认计划为未启用；保存并启用后由现有后台队列执行。手动运行会创建普通后台任务。
- 每次采集有来源与AI调用总上限、数量、页数、评论/回答数量限制。各渠道优先完成首轮，超过上限标记部分完成，不能据此宣称全量覆盖。
- 没有可验证上架日期、FBM发货证据或保健品证据的商品不写为对应新品；缺失证据在任务中说明。
- 定时编号按监控和北京时间日期去重；调整同日计划不重复建任务。来源和AI请求沿用持久请求记录，未知结果不会自动重复收费。取消及旧来源分析不会覆盖新资料。
- 不新增数据库表或迁移，不新增依赖。复用 workspace_documents、research_jobs、research_requests、现有加密模型配置、MCP客户端、队列锁及任务展示。

## 验证记录

- Sorftime：读取真实工具目录元数据，118项工具，核对6个商品渠道及4个社交工具的实际参数。没有执行任何真实 tools/call。
- 70项Node与PGlite检查通过，覆盖日期、发货方式、真实参数、市场、椰子油误归类、剂量、证据、调用上限、任务恢复、取消、重复调度、来源更新、历史采集入口与任务投影。测试禁用外部请求，使用合成样本。
- 完整Web类型检查、独立uiqa构建及diff检查通过。未执行全仓lint、CI或自动修改式提交钩子。
- Edge浏览器1440px/390px：监控保存、刷新读回、编辑及开关；6渠道与站点；成分原文及每月计划；90天手动任务提交通过。页面错误0，接口错误0，文档无横向溢出。截图和结果位于本工作树 `.artifacts/discovery-ui/`。
- 本地预览：http://127.0.0.1:4193/monitor；合成接口5400，不执行后台采集。可通过 `node scripts/discovery-preview.mjs` 和应用目录 `pnpm exec vite --mode uiqa --port 4193 --strictPort` 恢复。

## 集成信息与限制

- 分支：`codex/discovery-monitors-20261030`。
- 工作树：`D:/Project_Code/Intelligence_System/_worktrees/discovery-monitors`。
- 基线：已确认上线testing `271acd4c39b72796d72319fd05ddb371d85a8db7`。完整交付SHA见共享 DEVELOPMENT_COORDINATION.md。
- 共用入口：server/index.mjs、runner.mjs、store.mjs、task-projection.mjs、workspace-reads.mjs、market-jobs.mjs、platform-products-jobs.mjs、platform-product-data.mjs、product-resource-sorftime.mjs、product-jobs.mjs、manual-site.mjs、competitor-monitor-store.mjs、source-usage-domain.mjs；前端路由、navigation、monitor、products、sites、ads、data、PlatformProductsDialog、ProductDrawer。
- 尚未以真实收费商品/社交结果或真实模型验收；MCP能力元数据不保证每条结果都提供上架日期或完整配方。不用首次采集时间或曝光时间替代上架时间。
- 真实AI模型未配置时原文保留为待分析；需要配置有效模型后再提交分析。没有生产MySQL业务验收、正式数据回填或上线验证。
- 附件内容只作为待核对的资料；AI提示中明确禁止执行外部资料内的指令。
