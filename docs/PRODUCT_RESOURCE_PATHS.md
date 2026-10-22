# 商品资源获取路径与证据口径

核实日期：2026-10-22。本文区分公开官方文档、运行时工具校验、合成测试和真实账户验证。本次开发没有执行真实收费调用，没有读取正式业务数据作为测试样本，也没有验证账户权限、扣费价格或各市场实际覆盖率。

## 入口与范围

商品库沿用现有采集任务入口，选择来源、国家、关键词/真实类目/公开链接、商品目标数和有限预算。目标数为最多保存数量，不是全平台或全类目的覆盖承诺。

- 关键词发现、来源原生类目、来源热销榜和公开页面是不同路径，不把关键词样本改名为完整类目。
- “近30/90/180天”是销量统计请求窗口，不是商品上架时间筛选。当前没有核实能直接获取该滚动窗口全平台销量榜的现有接口。
- 原始平台类目与用户填写的研究分类分别保存。原生类目必须来自本次提供方查询回执；公开页面包屑仅证明该页面的原始路径。
- 同标题不合并为同一商品。来源商品ID、店铺、SKU/变体、规格和配方保留证据；缺失字段不靠标题猜测。
- 请求和保存继续沿用现有任务日志、检查点及商品库，不增加默认定时采集。

## 平台与市场

下表中的“开放”表示本实现可以选择该有界路径，仍须通过运行时校验；不表示真实账户或公网采集验收通过。

| 平台 | 开放市场与获取方式 | 可保留的来源指标 | 边界 |
| --- | --- | --- | --- |
| Amazon | US/MX：Sorftime关键词、原生类目/榜单、商品详情和已有历史；公开页与Brave发现 | 来源月销量、BSR、评论及原始历史序列，按返回字段保存 | 自然月不能换算成滚动30/90/180天；BSR不是销售件数或订单 |
| TikTok Shop | US/VN：Sorftime类目；US/MX/VN：ScrapeCreators关键词、店铺商品；US：ScrapeCreators商品详情；公开页与Brave发现 | 明确返回的展示累计已售、评分、店铺、来源类目/榜单 | 官方警告非US数据有限、不稳定；店铺`top`不代表全平台、全类目或指定周期销量榜 |
| Shopee | VN：Sorftime关键词、类目、详情/历史工具按账户schema；VN公开页与Brave发现 | 仅保留实际工具返回的商品、类目和指标 | 现有范围不开放US/MX替代站，不把其他国家结果冒充VN |
| Mercado Libre | MX：公开商品/类目页与Brave发现 | 结构化商品、价格和页面面包屑 | 未新增OAuth或外部供应合同；未核实现有渠道的交易、完整类目和销量历史接口 |
| Temu | US：Sorftime；US/MX：公开页与Brave发现 | 实际工具字段或结构化商品字段 | VN交易可用性未核实，不开放VN；MX公开页可能要求登录或缺少静态商品数据 |
| Instagram | US/MX/VN研究范围：现有ScrapeCreators内容发现、可核验落地商品页 | Reels/品牌内容及明确关联落地页 | 没有核实可用订单或商品交易销量接口；内容地域不证明买家国家 |
| Google Shopping | US/MX/VN：现有Semrush域名发现与Shopping广告索引 | 关键词、位置、搜索量、商家、URL、标题、索引价格 | 广告索引不是平台订单、商品销量或销量榜 |
| 品牌官网/本土站 | US/MX/VN研究范围：明确允许域名的公开页，或Brave发现后逐页读取 | JSON-LD商品、原币价格、规格/配方、店铺、变体及面包屑 | 用户选择国家只确定研究范围，不证明商品实际销售国；不保证全目录 |

Sorftime官方网页提及的站点总数和嵌入配置并不完全一致。本实现不以宣传站点数替代账户实时工具的市场枚举。TikTok MX原生类目未由本次资料确认，因此不能因为关键词API有`MX`参数就开放Sorftime MX类目。

### 路径编号

与`server/product-resource-domain.mjs`中的可选路径对照：

| routeId | 市场 | 方式 |
| --- | --- | --- |
| `amazon-sorftime` | US/MX | 关键词、实际类目、来源热销榜、精确商品链接 |
| `tiktok-sorftime` | US/VN | 实际类目、来源榜单、精确商品链接 |
| `shopee-sorftime` | VN | 关键词、实际类目、来源榜单、精确商品链接 |
| `temu-sorftime` | US | 关键词、实际类目、来源榜单、精确商品链接 |
| `tiktok-scrapecreators` | US/MX/VN | 关键词样本 |
| `tiktok-detail-scrapecreators` | US | 精确商品链接 |
| `tiktok-shop-scrapecreators` | US/MX/VN | 店铺链接，保留店内`top`或`new_releases`口径 |
| `shopping-semrush` | US/MX/VN | 关键词广告域名与Shopping索引 |
| `amazon-public` / `amazon-brave` | US/MX | 公开链接 / 关键词线索 |
| `tiktok_shop-public` / `tiktok_shop-brave` | US/MX/VN | 公开链接 / 关键词线索 |
| `shopee-public` / `shopee-brave` | VN | 公开链接 / 关键词线索 |
| `mercadolibre-public` / `mercadolibre-brave` | MX | 公开链接 / 关键词线索 |
| `temu-public` / `temu-brave` | US/MX | 公开链接 / 关键词线索 |
| `website-public` / `website-brave` | US/MX/VN研究范围 | 明确域名的公开链接 / 关键词线索 |
| `instagram-scrapecreators` | US/MX/VN研究范围 | 内容发现并保存公共内容，再核验原文明示的外部落地页 |

本分支最多保存100件目标商品，默认页数和预算仍可能先到达。只有来源明确的原生榜单才能标为来源榜单；不能把不足100件的样本或不支持的周期窗口标成完整类目前100。

## 渠道核实

### Sorftime

官方资料：

- [MCP介绍](https://www.sorftime.com/zh-CN/mcp/index?platform=1)
- [英文MCP](https://www.sorftime.com/en-US/mcp)
- [API介绍](https://www.sorftime.com/en-US/api)
- [MCP入口](https://open.sorftime.com/mcp)
- [API入口](https://open.sorftime.com/api)

官方API页面列出`CategoryTree`、`CategorySearchFromName`、`CategoryRequest`、`CategoryProducts`、`CategoryTrend`、`ProductRequest`、`ProductSearchFromName`、`ProductSearch`、`AsinSalesVolume`、`ProductVariations`、`VariationSalesTrendRequest`等能力。REST名称不能当成MCP工具的准确名称或参数契约。公开控制台有登录限制，本次未取得官方公开的完整工具schema、账户权限和扣费表。

运行时应先发现账户实际工具，对已知别名、必填字段和市场枚举逐项校验；不认识的结构明确停止，不猜参数、不轮流试调用。类目报告只有标题、排名或聚合指标而没有真实商品ID时，保持商品覆盖不支持，并在原请求日志保留有界脱敏`sourceReceipt`，不用标题拼造商品。回执记录工具、采集时间、平台/国家和允许的聚合字段；最多6层、500节点、数组50项、字符串700字符，完整JSON最多20,000个UTF-8字节，超出时改存截短片段。过滤字段记为`filtered`，截断记为`truncated`；凭据和URL会被清理，回执不能作为完整原始报告。

`sorftimeCalls`限制数据工具调用次数，不是人民币、美元或账户积分承诺。一次操作预留最多5次HTTP（最多4次控制请求和1次数据调用），成功后按明确返回的实际HTTP数核销；真实类目查询同样限定5次HTTP和1次数据工具调用。实际费用须由账户核实。

### ScrapeCreators

官方资料及本次核实内容：

| 官方文档 | 文档确认内容 | 不能推导的能力 |
| --- | --- | --- |
| [TikTok Shop搜索](https://docs.scrapecreators.com/v1/tiktok/shop/search/) | `GET /v1/tiktok/shop/search`，`query`、`page`、`region`；区域列有US/MX/VN；嵌套价格、累计已售、评分、卖家、商品链接 | 原生完整类目、任意日期销量、全平台销量排名 |
| [TikTok商品](https://docs.scrapecreators.com/v1/tiktok/product/) | `GET /v1/tiktok/product`，`url`、`region`；详情可含原生类目和`sale_region`；文档仅保证US可靠 | 非US详情稳定可用、过去30/90/180天销量 |
| [TikTok店铺商品](https://docs.scrapecreators.com/v1/tiktok/shop/products/) | `url`、`cursor`、`sort_by=top/new_releases`、`region`，`has_more`分页 | 店铺`top`等于全类目榜或近30天销量榜 |
| [Instagram Reels搜索](https://docs.scrapecreators.com/v2/instagram/reels/search/) | Google索引的Reels、日期过滤、有界分页；官方说明是尽力而为且不完整的搜索 | Instagram全量搜索、商品订单或交易销量 |

文档示例一般为每请求1 credit；任务同时记录实际`credits_charged`。缺少真实扣费回执时保留预留额度并停止来源，不记为0，不自动重放结果未知的收费请求。现有TikTok嵌套字段解析继续复用已集成的采集器，不从旧适配器覆盖字段修复。

### Semrush

官方资料：[Domain Reports](https://developer.semrush.com/api/v3/seo/domain-reports/)。`domain_shopping`为购物广告索引报告，支持域名、数据库、行数、偏移、列、筛选和排序；本次公开文档为当前30 units/行、历史150 units/行。`domain_shopping_unique`的费率和结果不同，不能混用。

现有发现链路先用广告域名报告，再请求Shopping索引；域名发现按现有实现预留20 units/行，Shopping按30 units/行预留。预留不是账户实际结算凭据，账户权限和真实用量未验收。历史广告位置不等于历史商品销量。

### Brave与公开页面

官方资料：[参数代码](https://api-dashboard.search.brave.com/app/documentation/web-search/codes)、[Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/post)。现有接口为`GET https://api.search.brave.com/res/v1/web/search`，一页最多20条，`offset`为0至9。`more_results_available`决定是否仍有结果，重叠页需去重停止。网页新鲜度不等于商品销量窗口。

越南沿用项目已有的`country=ALL`、`search_lang=vi`及国家提示头；这不是来源实际销售国的证明。Brave只保存URL/标题线索，不将搜索摘要解析成商品或销量。每个搜索页为一次Brave请求，每个落地页、重定向和下一页另外计入公开HTTP请求预算。

公开读取使用已有受校验的HTTPS传输：显式域名白名单、DNS公网检查并固定连接地址、5MB页面上限。每一步仅发起一次HTTP读取，不自动跟随跳转，不处理登录、验证码或访问限制。需要浏览器渲染而静态无数据的页面返回缺失/不可用状态。

平台白名单为Amazon US/MX、Shopee VN、Mercado Libre MX、Temu US/MX、TikTok及明确允许的品牌站域名。TikTok通用域名还需来源销售区域证据；Temu需来源区域或与所选国家一致的明确路径。没有开放`instagram-public`或`instagram-brave`商品路径；合法Instagram入口由提供方适配器取得`contents`并写入现有公共内容库，再将原文明示外链作为`website-public`任务逐页核验。Instagram内容本身不创建交易商品。

公开解析只接受明确的JSON-LD`Product`节点。`ItemList`和普通商品链接作为待读取线索；`BreadcrumbList`保留原始类目名称及URL，不声称完整平台类目树。价格范围、缺少币种或缺少价格均不变成精确价格或0。原价字符串、小数位数、币种、采集时间及证据URL保留；数值字段仅供现有展示/排序使用。

公开页面支持的结构不等于真实站点一定提供该结构。Shopee VN和Mercado Libre MX有官方站点/开发者资料，但本次没有用它们确认任何账户的批量采集权限：

- [Shopee VN](https://shopee.vn/)
- [Mercado Libre Items and Searches](https://developers.mercadolibre.com.mx/en_us/items-and-searches)

## 指标与历史

- 件数、订单、累计展示已售、自然月销量、BSR、广告位置和观察增量分别保存，不相互换名。
- 滚动窗口仅在来源原始窗口完全一致，或同一商品同一国家有覆盖完整日期的逐日销量时，才形成可比较周期值。
- 来源缺失或历史不足保持未知/待积累，不填0，不把首轮快照补造成过去180天历史。
- 样本排名只比较相同指标、单位、原始窗口和可接受精度的本次已采集商品；不代表全平台名次。
- 原生热销榜保留来源顺序及来源统计说明。来源榜单也不自动等于请求的滚动销量窗口。
- 每次观察保留来源商品身份、原始字段、采集时间、证据链接和覆盖声明，旧历史在独立归档保留。

## 预算、恢复与停止

本任务的请求、来源调用、Sorftime调用、ScrapeCreators credits、Semrush units、Brave请求、分页数和详情商品数都有独立有限上限。没有隐式浏览器和模型调用，本路径的浏览器/模型额度为0。分页重复、目标数量到达、预算耗尽、鉴权失败、限流、未知扣费和不支持字段均产生明确停止状态。

搜索和来源发现页计入发现分页上限；公开商品落地链接、独立输入URL及跳转逐个计入HTTP预算，不消耗搜索页数。公开列表页沿自身下一页路径仍受翻页深度限制。达到100件目标需要对应数量的可核验商品及足够HTTP预算，默认预算不保证取得100件。

持久化请求检查点区分已确认结果与结果未知的调用；恢复应复用已确认结果，避免收费请求重放。某个来源停止时，已确认商品及其证据保留。任务取消只停止后续工作，不把已保存来源证据伪装成未执行。

## 验证与交付边界

公开适配器专项测试：

```shell
node --test server/product-resource-public.test.mjs
```

14项合成用例覆盖平台/市场及URL限制、Brave单页与限流不重放、原价精度/币种/配方证据、缺失/区间价格、同名SKU区分与稳定身份、变体/类目面包屑区分、链接/分页线索、可选字段异常、原始采集时间及缓存保留、空结果15分钟过期、TikTok/Temu市场证明、DNS地址固定与单次跳转、登录/验证页及Instagram仅内容线索。它们不证明真实平台页面可访问、API权限、覆盖率或扣费。

引擎、证据面板和任务入口的整体测试、类型检查及构建以本功能最终交付记录为准。功能开发完成、合成测试通过、真实账户测试、测试部署、正式发布是分别记录的状态；本文没有正式上线声明。

### 本机交付验证

- 144项Node专项与相关回归通过，涵盖新增路径、物理请求与来源独立预算、变体身份、分页、旧平台入口、TK字段、公开传输和Semrush协议。
- 隔离PGlite实际迁库后7项全链路检查通过：类目凭证/祖先、提交幂等、请求journal恢复、商品及内容入库、列表/详情/完整导出、不可变归档和取消恢复。外部请求0。
- 56项前端相关测试、完整源码别名Vue类型检查、server/history生产模式前端构建和布局工具类检查通过。
- 浏览器合成API检查覆盖1440×1000和390×844、显式类目/子类目查询、切换来源和模式、有限预算提交、58商品分50+8导出、50+2观察归档分页和同任务恢复。页面脚本错误0、文档横向溢出0。图标CDN在隔离检查中被阻止，因此不把外部图标加载计入通过项。
- 未执行真实账户收费验证、Docker/API镜像或MySQL8本机验证，未部署测试或正式环境。已将新增专项、前端及隔离SQL检查接入现有testing CI；准确集成候选仍须通过CI。

## 集成注意

功能基线为本机已确认的testing提交`825d264adac98adea2f09d19da7bed0ebb800a17`，功能分支`codex/product-resource-paths-20261022`。本轮远端读取失败，不据此宣称远端或正式环境已同步。

- 新运行模块集中在`server/product-resource-{domain,engine,provider,public,service,sorftime}.mjs`；复用现有`research_jobs`、`research_requests`、`workspace_documents`，没有新增收费任务调度。
- 共用后端入口：`platform-products-jobs.mjs`、`platform-products-provider.mjs`、`platform-product-data.mjs`、`index.mjs`、`runner.mjs`、`workspace-reads.mjs`。按Git合并保留其他功能；不要复制整份旧文件覆盖。
- `semrush-reports.mjs`只增加可选传输注入参数，默认连接方式保留；`public-article-http.mjs`只导出已有单次读取用于独立计费跳转，不改变既有文章传输逻辑。
- 轻量列表投影加入资源证据，模型版本为`workspace-reads-v4-product-resources`，会重建派生读索引；历史观察按需分页，不向浏览器全量下发。`model.ts`运行逻辑未改变，本功能无生成`model.js`变更。
- 前端共用`PlatformProductsDialog.vue`、`ProductDrawer.vue`、`TaskProgress.vue`、`products.vue`、`monitor.vue`、`data.ts`和`cloud-workspace.ts`；新增`product-resources.ts`与`ProductResourceEvidence.vue`。类目查询超时120秒，其余云请求超时保持原值。
- `server_product_resource_capabilities`和`server_product_resource_observations`沿用已登录研究员可读权限；类目查询与恢复沿用管理员写操作权限。能力查询只检查配置名称，不证明Key权限有效。
- 观察归档和类目回执是服务端保留字段，通用工作区编辑不会写入。聚合回执仅保存在对应请求journal，详情页面不把它当商品或销量证据。
- 提交/测试/构建的正式交付SHA与位置在根`DEVELOPMENT_COORDINATION.md`登记；本机合成预览与截图是验收辅助，不作为真实供应商覆盖率证据。
