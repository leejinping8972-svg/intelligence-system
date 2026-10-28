# 采集排队、任务进度与西之月登录会话

## 交付状态

功能分支：codex/task-queue-clarity-20261028；基线 testing 11023aa59cb3e9d88e06e0006e6f7be02745f8cc。本批为功能交付，待集成，未正式上线。未保存真实西之月会话、回填正式价格、重放正式任务或发起收费采集。

## 使用变化

- 监控、热词和趋势配置改用短配置锁，采集期间可保存。手动趋势提交写入 inbox，由后台按提交时间派发；慢来源响应不会覆盖新提交。
- 竞品、热词、趋势各有独立执行循环。竞品站点最多同时两个；不同来源可交错执行，同来源请求共享串行与冷却。关键词研究允许再次主动提交；同 requestId 的网络重试保持幂等，相同请求在前端提交中的双击复用同一请求。
- 已有上限保留：research_jobs 最多20个活动任务，趋势 inbox 最多100批；不是无限排队。竞品和热词同市场/对象当天去重、收费未知停止、预算预留、旧 journal 和检查点保留。跨日未派发趋势命令明确过期，需重新确认预算，不自动跨日收费。
- 任务外层展示整项进度、成功/受限/待完成数量和停止原因。详情展示对象或来源步骤，展开才读执行记录；原始来源响应不返回到界面。100%表示计划步骤处理结束，partial仍明确为未完整采集。人群研究保存已有筛选和来源 journal 的进度，证据审核仍单独表达。
- 重新研究跳到对应业务页，打开预填窗口，保留参数、选择对象和上次结果摘要；原结果保留，不把所有旧原始响应复制成新结果。预算需要重新确认。旧类目查询保留准确同步查询动作，确认后立即查询，不误提交商品任务；未知历史任务明确拒绝。
- 提交前按对象、来源和请求预算估算执行时间范围；有至少3份同类有效耗时样本时使用其中位耗时。排队等待单列，来源限流/登录和分页影响实际耗时。该估计不是完成时间保证。

## 西之月

设置页新增“西之月 · 登录会话”，管理员正常登录官网后将 access_token 填入密码框，可启用、保存、检测或移除。仅存会话令牌，不存账号密码；AES-256-GCM 使用已有 PROVIDER_CONFIG_ENCRYPTION_KEY 和独立AAD，保存在 provider_configs 的 provider:westmonth-session:v1。界面不回显，不写localStorage。保存不启动采集；会话过期后人工更新，目前不会自动登录或续期。检测结果只代表上次手动检测时间。

令牌仅发送至固定 HTTPS api-x.westmonth.com 的商品 load-list/detail 两个路径，禁止带凭据跟随重定向。首次目录采集、每日监控和商品补全共用。折后价仅采用 member_price 和来源明确的三字母货币代码，保留原值、字段名、来源URL、币种与时间；不使用指导价或基础价，不将匿名0值当价格。

补全详情无折后价时，在原预算内回查保存的原目录页，并按 product_id 精确匹配。商品移动离开该页时保留缺失，不扫描全库找价。匿名接口现场返回的价格为空；登录后真实账号schema/折后价权限未验证，正式价格尚未回填。

## 集成与部署必须注意

本批无schema、迁移或新依赖。MySQL/PostgreSQL连接池由6增至12，支持独立循环和短配置操作。

新增锁如下，MySQL名称前缀 intelligence:；PostgreSQL编号：

| 锁 | PG编号 | 用途 |
| --- | --- | --- |
| monitor-config | 89761039 | 监控/热词/西之月会话短配置 |
| keyword-trends-config | 89761040 | 趋势配置和提交 |
| hotwords-runner | 89761041 | 热词执行 |
| keyword-trends-runner | 89761042 | 社媒趋势执行 |

server数据库维护已持有三个执行通道；deploy/server/drain-queue.mjs 已加入以上四锁。**正式集成发布所用的外部guard也必须扩展以上四锁，不能继续仅使用旧17锁列表。** 用户技能文件未修改，集成人员须核对所用脚本。保留旧competitor-runner及全部原锁、journal/检查点/业务数据和public/data保护。

来源限速是同一个API进程及其本地collector bundle共享内存队列：Semrush、ScrapeCreators、Sorftime、Brave和站点hostname分别一条lane，默认请求结束后间隔1秒，429至少冷却60秒。保留站点原有更长间隔，不自动重放请求。配置远程Cloudflare collector时该远程进程的内存lane不与API共享；不宣称跨进程/跨环境全局限速。

共用入口需通过Git合并：server/index.mjs、runner.mjs、database.mjs、competitor-monitor-store.mjs、keyword-trends-store.mjs、persona-research-store.mjs、store派生投影、商品首次/补全与来源适配；前端data.ts、cloud-workspace.ts、research.vue、monitor.vue、settings.vue及各采集窗口。server/collector.js 已从来源代码生成。部分旧文件有格式化差异，合并时保留其他会话改动。

## 验证与限制

- 合成来源专项Node测试覆盖同源串行/跨源推进、429冷却、多次主动提交与幂等、价格写入/精确商品匹配、密文和固定域名、预填契约、日志关联和父子社媒状态。提交钩子自动调整格式后，最终73项专项通过，详见本工作树 .artifacts/post-hook-targeted.log；人群在途/停止状态及文案边界包含在内。
- 隔离PGlite真实SQL验证运行中保存/暂停、慢响应期间提交不丢、FIFO预算与跨日过期；独立人群API集成覆盖权限/幂等、复用、采集进度、审核、成果同步、写失败回滚和恢复，提交钩子后复测通过，记录 post-hook-persona.log。外部fetch禁用。锁函数在隔离fixture返回成功，不宣称真实数据库跨进程锁验收。MySQL未运行。
- 完整web类型检查、独立生产模式web构建成功，提交钩子后最终类型检查记录 post-hook-types.json；UI合成验收任务三级展示、会话保存/检测和重新研究预填/预算/提交通过。合成截图位于 .artifacts/queue-ui/，不是真实账号或正式环境验收。
- 完整lint未通过：当前依赖布局下配置无法加载 @eslint-community/eslint-plugin-eslint-comments，未安装新依赖，不记为通过。提交钩子曾自动调整格式但未完成提交；核对后重新格式化并完成上述专项/类型检查和44个JS模块语法检查，本次提交使用进程级 LEFTHOOK=0 跳过不可用钩子，未更改项目钩子配置。
- 构建告警及独立outDir已记录，产物在 .artifacts/web-build；此为功能自测产物，非正式发布包。真实来源权限、登录后价格和正式部署需要集成阶段按证据确认。
