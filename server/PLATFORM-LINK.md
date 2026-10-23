# 选品平台与 AI 全域平台账号 key 免登录对接

协议：Platform Link v1，依据对方《selection-platform-key-binding-sso-plan.md》v1.1 补充浏览器会话接入约定。日期：2026-10-23。

本文供双方开发、运维和联调使用。选品侧代码已完成本机开发和隔离测试，尚未集成、部署或完成真实对端联调。文中的对方路径是待双方确认的契约，不表示对方线上接口已经可用。完整验证结果见第 9 节。

## 对方实施清单

1. 确认第 2 节 B 的 origin、source、callback、登录后首页，以及稳定账号 ID 字段。原方案仅约定生产对接，没有独立调试地址、测试账号或可用 key；若另有测试环境，可另行提供双方可访问的 HTTPS origin，但不作为本版实施前置条件。
2. 实现第 4 节四个公共入口：`POST /key/inspect`、`GET /login/start`、`POST /login/tickets`、`GET /login/consume`。服务器之间只用目标账号 key 调用 inspect 和 tickets。
3. 在个人设置中实现当前账号 key 的生成、撤销及对方 key 的验证保存；每个方向单独配置。长期 key 不在浏览器跳转中传递。
4. 实现第 3、5 节本地 launch/callback、同源消费和换号确认。若 B 使用 localStorage Bearer，其过渡页必须接入 B 现有会话管理；A 不会替 B 读取或写入会话。
5. 实现第 6 节一次性票据、浏览器绑定、撤销与事务保护，并按第 8 节返回错误。请特别覆盖来源退出、目标换号、过期、重放和撤销。
6. 默认关闭部署，按第 9 节安排联调窗口、准备少量指定账号、安全交换 key 并完成双向联调。窗口内需开启站点级开关；真实 HTTPS 双域验证完成后再按双方各自发布流程决定持续开放。

## 1. 范围与授权含义

双方分别生成当前账号专用的登录 key，由用户主动填入另一平台。来源服务器使用保存的 key 换取目标平台 60 秒一次性 ticket，目标平台创建自己的普通本地会话。两个方向独立配置、独立移除；只配置一边只开放一个方向。

持有有效 key 即可申请该账号登录，不能证明调用者一定是指定平台。第一版允许用户主动共享同一个 key，不强制账号一对一，不自动注册、不共享密码或数据库、不从对方接收角色权限，也不提供全局退出。目标端权限由目标端现有账号决定；撤销 key 不会自动退出已经创建的普通会话。

用户需点击“进入 AI 全域平台”或“进入选品平台”发起流程。普通静态链接、收藏夹以及打开后台首页不自动执行本协议。第一版无需系统级客户端凭证、grant 表、双向对账或自动轮换。

## 2. 固定参数

| 项目 | 选品平台 A | AI 全域平台 B |
| --- | --- | --- |
| HTTPS origin | `https://is.luckdate.com` | `https://ai.chatviva.com` |
| `source` 标识 | `selection-platform` | `ai-platform` |
| API 前缀 | `/api/platform-link/v1` | `/api/platform-link/v1` |
| 来源固定 callback | `https://is.luckdate.com/api/platform-link/v1/launch/callback` | `https://ai.chatviva.com/api/platform-link/v1/launch/callback` |
| 登录后固定首页 | `/admin/overview` | `/admin/` |
| 稳定账号身份 | 本地账号 ID 转字符串 | 对方稳定账号 ID 转字符串 |

B 的 `source`、callback 和首页需对方书面确认；本表是本次提出的固定值。地址由管理员配置并使用精确白名单，不接受用户提供的 host、callback、destination 或任意 URL。`origin` 不带尾斜杠，所有 API 路径均在 origin 根路径下，不加 `/admin` 前缀。显示名用于展示，账号匹配只使用稳定 ID。

以下路径均相对于 `/api/platform-link/v1`。公共接口采用 HTTPS JSON，服务器调用建议 10 秒超时；跨站浏览器跳转不共享 Cookie，也不依赖跨域设置 Cookie。无需为服务器间调用开放浏览器 CORS。`state`、`request_id`、`ticket`、`confirm` 均为安全随机 32 字节的 base64url 无填充编码，长度 43，仅含 `A-Z a-z 0-9 _ -`；双方须遵循此格式。

## 3. 完整跳转顺序

### 3.1 AI 全域平台 B -> 选品平台 A

1. 用户已登录 B，且 B 当前账号已保存 A 的 key。浏览器带 B 现有认证调用 B `POST /launch`，请求 `{}`。
2. B 确认当前用户及会话有效，保存 5 分钟 launch 状态，绑定发起用户、发起会话及随机 `state`；设置 B 自己的临时浏览器 Cookie，返回 `{ "ok": true, "redirect": "<固定 A start 地址>" }`。
3. 浏览器前往 A `GET /login/start?source=ai-platform&state=...`。A 校验固定 source，设置 A 自己的临时浏览器 Cookie，创建 5 分钟 `request_id`，303 到 B 固定 callback，查询参数为 `state` 和 `request_id`。
4. B `GET /launch/callback` 校验 launch Cookie 后返回同源过渡页。过渡页带 B 自己的现有认证调用同源 `POST /launch/callback`，请求 `{ "state": "...", "request_id": "..." }`。B 必须复核当前用户、当前会话仍等于 launch 发起者；退出或换号后旧流程失败。
5. B 服务器读取该用户保存的 A key，调用 A `POST /login/tickets`，请求 `{ "request_id": "..." }`，Authorization 使用该 A 专用 key。A 原子标记 request 已签票，返回 ticket。
6. B 将固定 A `GET /login/consume?ticket=...` 地址交给浏览器。A 返回同源过渡页，随后由该页调用同源 `POST /login/consume`，请求 `{ "ticket": "..." }`。
7. A 的 POST 校验 ticket、A 临时浏览器 Cookie、有效期、key 和账号状态，并读取 A 当前本地会话。未登录或已登录同一账号时可完成登录；已登录不同账号时只返回一次性 confirm 状态，显示“将切换至 XXX”，此时不能替换现有会话。
8. 用户在 A 同源页面调用 `POST /login/confirm`，请求 `{ "confirm": "...", "accept": true }` 才执行切换。取消发送 `accept: false`，保持原账号。成功后浏览器进入 A 固定 `/admin/overview`，地址栏不保留 ticket 或其他凭据。

### 3.2 选品平台 A -> AI 全域平台 B

1. A 已登录用户调用 A `POST /launch`；A 创建绑定本用户、本会话的 launch 状态。
2. 浏览器前往 B `GET /login/start?source=selection-platform&state=...`。
3. B 创建浏览器绑定 request，303 到 A 固定 `https://is.luckdate.com/api/platform-link/v1/launch/callback?state=...&request_id=...`。
4. A 的 GET callback 返回同源过渡页；同源 POST callback 复核 A 原用户、原会话，A 服务器用保存的 B key 请求 B `POST /login/tickets`。
5. 浏览器前往 B `GET /login/consume?ticket=...`；B 的同源 POST consume 校验自己的浏览器标记和当前账号，必要时经同源 POST confirm 确认切换，最后进入 B 固定 `/admin/`。

这两个方向均只由服务器发送长期 key。key、普通会话 Bearer 和新建的会话凭据都不得放入跳转 URL。

## 4. 公共接口

### 4.1 POST `/key/inspect`

用于来源服务器验证目标平台的专用用户 key。

```http
Authorization: Bearer <目标平台专用登录 key>
Content-Type: application/json
```

请求 `{}`，成功返回：

```json
{ "ok": true, "subject": "789", "display_name": "张三", "expires_at": null }
```

`subject` 是稳定字符串 ID，非空、最多 128 字符且不能含控制字符。`display_name` 为最多 200 字符的字符串，去除首尾空白后须非空。`expires_at` 为 Unix 毫秒时间戳或 `null`；A 第一版不自动过期，返回 `null`。原 v1.1 未规定非空格式，双方需按本约定统一；如有到期时间，签票与最终登录都必须检查。须检查 key 未撤销、账号未停用或锁定；不能根据传入的任意用户 ID 查询其他身份。对方响应体不得超过 8 KB。

### 4.2 GET `/login/start?source=...&state=...`

无需目标端已有登录。只允许对方固定 source，callback 从服务端配置取。创建随机 request，绑定目标浏览器，并将 `state` 原样带回来源固定 callback。`state` 由来源校验；目标不得自行替换它或接受动态回调。

### 4.3 POST `/login/tickets`

Authorization 与 inspect 相同。请求及响应：

```json
{ "request_id": "<目标平台生成的随机句柄>" }
```

```json
{ "ok": true, "ticket": "<一次性随机票据>", "expires_in": 60 }
```

账号只由 key 确定，不接收 `target_user_id`、role、密码或 destination。request 必须有效且尚未签票；签票与标记 request 必须原子执行。重复签票返回 409。响应丢失时重新点击开启新流程，不恢复旧 ticket，不无限重试。

### 4.4 GET `/login/consume?ticket=...`

浏览器导航入口，返回本平台同源过渡页，不在跨站 GET 阶段直接覆盖会话。页面通过同源 POST 完成下节的验证、登录或切换确认。ticket 必须绑定该目标浏览器；转发链接给另一浏览器不能登录。

## 5. 各平台同源接口与现有会话

以下接口是本平台内部接口，按现有认证方式调用，不能把它们当作开放给对方的业务 API。

| 方法与路径 | 请求 | 行为 |
| --- | --- | --- |
| POST `/launch` | `{}`，当前登录认证 | 创建 launch；返回 `ok` 和固定 `redirect` |
| GET `/launch/callback` | query: `state`、`request_id` | 校验 launch Cookie，返回同源过渡页 |
| POST `/launch/callback` | `{state, request_id}`，当前登录认证 | 校验浏览器、state、原用户和原会话，服务端换票，返回固定跳转地址 |
| POST `/login/consume` | `{ticket}`，目标临时 Cookie 及当前本地认证（如有） | 原子消费；创建本地会话或产生 confirm |
| POST `/login/confirm` | `{confirm, accept}`，同一浏览器及当前本地认证（如有） | 确认才切换；取消保持原会话 |
| POST `/account-key/generate` | `{confirm:true}`，当前登录认证 | 生成或重新生成本账号 key，原文只返回一次 |
| POST `/account-key/revoke` | `{confirm:true}`，当前登录认证 | 撤销自己的 key，关联待完成登录全部失效 |
| GET `/settings` | 当前登录认证 | 只返回脱敏 key、目标账号信息与状态 |
| POST `/peer-key` | `{key:"<对方 key>"}`，当前登录认证 | 服务器 inspect 成功后加密保存 |
| DELETE `/peer-key` | `{}`，当前登录认证 | 仅删除本用户出站配置，不撤销反向 key |

本地用户 ID 从认证会话取，不接受前端指定。普通用户可以管理自己的配置；页面位于管理区不代表 key 是全局配置。更新 key 验证失败须保留旧配置，验证成功后才整体替换。

目标当前账号与 key 账号相同可以继续；不同时生成 60 秒一次性 confirm，记录目标账号及当时本地会话。最终确认须检查当前会话仍与提示时一致；另一标签页换号后应重新发起，不能用旧确认覆盖后来登录。confirm、可选 bootstrap 兑换时都要重查 key、账号状态及接入开关。未确认、拒绝、超时、验证失败都不修改旧会话。

选品 A 复用正常本地登录建立自身会话，不改变原密码登录和退出规则。目标若使用 `SameSite=Strict` 会话 Cookie，跨站 GET 可能不携带它，必须经同源页面的 POST 读取当前会话，不能在 GET 推断“未登录”。临时流程 Cookie 使用 host-only、Secure、HttpOnly、SameSite=Lax。

若任一端使用 localStorage Bearer，其同源过渡页负责从自身现有会话管理读取 Bearer，添加到同源 POST；新会话也通过同源响应交给现有会话管理。可用短期一次性、绑定浏览器的 bootstrap 完成兑换，但不能用长期 key 当 bootstrap，不能跨域读写 localStorage，不能把普通 Bearer 放 URL。双方保持各自会话实现即可，公共 key/ticket 接口不受影响。

## 6. 持久化、撤销与安全要求

- A 生成 `sel_` 前缀加安全随机 32 字节的 key；B 可使用自己的前缀。key 长度须为 16 到 512 个可打印 ASCII 字符，不含空白。签发端仅存 key 哈希、稳定 user ID 和脱敏标识；每账号只保留一个当前 key，原文生成时完整显示一次。
- 使用端以成熟 AES-256-GCM 加密保存对方 key，随机 nonce 与密文入库，加密主密钥独立保存在服务端配置中。配置接口和日志不返回保存的 key 原文。
- launch、request 有效期 5 分钟；ticket、confirm 及可选 bootstrap 有效期 60 秒且一次性。所有随机句柄使用安全随机值，数据库只存其敏感随机值哈希，并保存浏览器绑定、用户、key 及必要的会话关联。
- 重新生成或撤销 key 后，旧 key 及其关联的 ticket、confirm、bootstrap 立即失效。使用不可复用的 key 记录 ID 或版本，不得覆盖 key 后让旧票据重新有效。账号停用同样阻止签票和最终登录。
- 用事务或条件更新保证 request 单次签票、ticket/confirm/bootstrap 单次消费，以及最终 key/账号状态校验。并发撤销与消费应有明确的原子顺序；撤销已生效后不能再完成新登录。不同数据库连接不会自动构成同一事务。
- 会话创建失败不重新开放已消费票据，提示重新发起。取消或失败不能覆盖原账号。关闭接入开关后拒绝新发起、签票、消费和最终确认，保留原普通登录。
- 本地写接口校验 Origin/已有 CSRF 机制；GET 回调校验 state 和浏览器标记。inspect、签票及流程入口设置基础限流；外部错误不泄露 key、ticket、密文或内部堆栈。
- 回调、消费、确认及过渡页响应设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`，不加载第三方统计。桥接页使用 CSP，仅允许受控脚本和同源连接，禁止被框架嵌入、动态基址和外站表单提交。
- nginx/Caddy、CDN、APM 和应用均不得记录 Authorization、请求体中的 key 或 ticket 完整查询串；日志只记事件、结果和必要的非敏感关联 ID。

长期账号 key 哈希及加密的出站配置属于需要备份的认证资料；加密主密钥须另行安全保存，不能和密文放在同一数据库备份中。短期 login flow 状态不随备份、恢复或迁库复制；恢复后重新发起流程。备份和密钥都不得进入 Git。

## 7. 选品侧配置与启用

| 环境变量 | 选品 A 的值或用途 |
| --- | --- |
| `PLATFORM_LINK_ENABLED` | 默认 `false`；联调窗口先设为 `true` 才能生成 key 和调试；部署和正式启用按发布流程执行 |
| `PLATFORM_LINK_PUBLIC_ORIGIN` | `https://is.luckdate.com` |
| `PLATFORM_LINK_PEER_ORIGIN` | `https://ai.chatviva.com` |
| `PLATFORM_LINK_SOURCE` | `selection-platform` |
| `PLATFORM_LINK_PEER_SOURCE` | `ai-platform` |
| `PLATFORM_LINK_ENCRYPTION_KEY` | 独立的服务端加密密钥，base64 编码的随机 32 字节，本文不包含真实值 |
| `PLATFORM_LINK_TRUST_PROXY` | 默认 `false`；仓库 Compose 的受控 Caddy 内网部署设为 `true`，用于按真实客户端 IP 限流 |

B 对调 PUBLIC/PEER origin 与 SOURCE/PEER_SOURCE；callback 与目标地址由固定配置推导，不能由普通用户填写。双方不必共享加密主密钥；用户输入的对方账号 key 是各方向的服务器间凭据。

当前开关作用于整个站点，没有账号白名单模式。关闭时仅允许已登录用户读取脱敏 settings，其余新协议接口均拒绝；因此不能在关闭状态完成联调。第一版依照原方案仅对接生产域名：先在本地完成合成测试，再在双方各自授权的短时联调窗口开启站点级开关，由指定少量账号联调，结束后关闭或按发布流程持续开放。开启期间并无技术上的账号白名单限制，不能将“指定账号联调”表述成“仅这些账号可用”。如双方已有隔离 HTTPS 环境，可先在其中验证。

启用 `PLATFORM_LINK_TRUST_PROXY` 时，API 只允许受控代理访问，不能同时暴露可被公网直连的端口。Caddy 覆写 `X-Platform-Link-Client-IP` 为连接的真实客户端地址，应用仅在信任开关开启且该头为单个合法 IP 时使用它，否则回落到 socket 地址。不能将用户传入的转发头直接当作限流身份；对方可采用等效的可信代理方案。

本协议与旧 `ADMIN_SSO_*` 管理员映射协议不同。采用新协议时旧 `ADMIN_SSO_ENABLED` 保持关闭，并抑制其首页自动跳转，避免两套流程竞争。仅部署接口或显示顶部入口不代表免登录已经启用。GitHub Pages 的静态前端也不能单独完成本协议。

## 8. 错误与重试

JSON 失败响应：`{ "ok": false, "code": "...", "message": "..." }`。页面显示可理解的失败提示并保留普通登录入口，不两端循环，不无限轮询，不因失败删除原出站配置。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 参数缺失、格式或固定 source 不合法 |
| 401 | `KEY_INVALID` | key 无效或已撤销 |
| 403 | `ACCOUNT_DISABLED` | 目标账号停用或锁定 |
| 409 | `REQUEST_ALREADY_ISSUED` / `TICKET_USED` | request 已签票或 ticket 已消费 |
| 410 | `REQUEST_EXPIRED` / `TICKET_EXPIRED` / `KEY_EXPIRED` | 相应凭据过期 |
| 429 | `RATE_LIMITED` | 限流，可带 `Retry-After` |
| 503 | `LOGIN_DISABLED` | 接入关闭或临时不可用 |
| 503 | `SESSION_FAILED` | 本地会话创建失败；票据已消费，须重新点击发起 |

本地认证、浏览器不匹配、state/confirm/bootstrap 校验失败可采用本平台既有错误码；须失败关闭、不创建会话，不将敏感随机值拼入错误内容。用户重新点击后建立新流程，不复用过期或已消费状态。

## 9. 联调准备、验收与当前事实

对方需确认第 2 节常量、第 4 节字段限制和自己的会话创建方式，提供指定少量联调账号的安全交换渠道；真实 key 不进入本文、聊天记录附件或 Git。先使用合成账号和本地模拟完成自动化测试，再按第 7 节安排已开启开关的真实 HTTPS 双域联调。生产部署默认关闭，持续开放需双方联调通过及发布授权；本次没有操作正式环境。

验收至少包含：

1. 双方生成和保存专用 key，目标显示名/稳定 ID 正确；无效替换保留旧配置。
2. B -> A、A -> B 均进入 key 所属账号；只配一个方向时另一方向不可用。
3. 目标同账号直接继续；不同账号先确认，取消、超时、另一标签页换号都不覆盖现有会话。
4. 票据过期、重放、篡改 state、错误浏览器失败；并发签票只成功一次，并发消费只创建一次登录。
5. 来源退出或换号后旧 callback 失败；目标确认前撤销、重新生成 key 或停用账号后，旧 ticket/confirm/bootstrap 全部失败。
6. 移除配置只影响当前方向；撤销本账号 key 阻止对方后续登录，既有普通会话不默认退出。
7. 关闭接入后待完成流程失败；原密码登录、权限及本地退出正常，URL/网关/APM/应用日志不出现长期 key 或普通会话凭据。
8. 真实 HTTPS 双域浏览器核对 Cookie、Strict 会话过渡、no-store/no-referrer/CSP，以及 localStorage 端的同源会话写入。

已观察事实：2026-10-23 17:31（北京时间），不带凭据 POST `https://ai.chatviva.com/api/platform-link/v1/key/inspect` 和无参数 GET `https://ai.chatviva.com/api/platform-link/v1/login/start` 均返回 HTTP 404 HTML。该检查只反映当时这些公开路径的响应；未提供真实 key、读取账号或建立会话，不能据此判断对方代码是否已开发，也不构成真实联调通过证明。

本次选品侧本机验收记录（均使用合成账号和隔离数据）：

| 项目 | 结果 |
| --- | --- |
| 新协议、存储加密、代理限流、旧 SSO、密码策略和现有认证回归 | 63 项 Node 测试通过，失败和跳过均为 0 |
| 前端个人设置、一次性 key 清理、入口与会话相关回归 | 23 项测试通过 |
| 完整 web-antd 类型检查 | 通过 |
| 服务端模式、history 路由、`/admin/` 基址的前端生产构建 | 通过，仅本机生成产物 |
| Chrome 设置页和顶部入口，1440、390、320 宽度 | 通过；含生成确认、单弹窗展示及清理、无效替换保留、未配置跳设置、关闭开关；页面无横向溢出，顶部按钮完整可见，脚本错误 0 |
| 真实 Chrome、本机双域 HTTPS 的核心登录流程 | 8 项检查通过、69 个本机浏览器请求；含双向跳转、Strict Cookie 同源恢复、不同账号确认/取消、最终 URL 清理、错误浏览器拒绝；页面及路由错误 0 |

HTTP/SQL 测试运行两套独立 PGlite 数据库，并复用选品现有密码、会话及审计实现。核心浏览器测试将两个域名强制解析到本机 HTTPS 临时端口，使用自签 QA 证书及隔离服务，未向真实两域发送请求。未连接生产数据库、未调用收费来源；真实 MySQL/Docker、远端 CI、对方实际会话实现（包括其 Bearer 过渡页）及真实网关部署未验证。上述本机结果不代表对方实现已完成或真实双站联调通过。

交付分支为 `codex/platform-link-sso-20261023`，本机目录为 `D:/项目代码/Intelligence_System/_worktrees/platform-link-sso`。完整提交 SHA 与集成状态登记在项目根 `DEVELOPMENT_COORDINATION.md`。当前为功能交付、待集成，未测试部署或正式上线；真实对端接口及生产登录仍需双方完成联调。
