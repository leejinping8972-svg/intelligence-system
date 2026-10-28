# 统一身份单点登录接入文档

版本：OIDC 1.0 / 2026-10-27。适用：Intelligence System 与全球电商AI经营平台。

本次交付为我方功能分支，尚未集成或正式启用。下面地址是约定的正式地址，部署并启用后提供服务。对方仍需实现客户端、迁移旧账号并联调；旧个人 key 协议的联调成功不代表本协议已验收。

## 1. 最终体验与职责

我方提供统一身份服务，使用 `oidc-provider` 实现标准 OpenID Connect。AI平台作为保密客户端，使用成熟 OIDC 客户端库，例如 Node.js `openid-client`、Python Authlib、Java Spring Security 或 PHP League OAuth2/OIDC 扩展。

- 我方现有账号是统一账号，ID不变，原密码继续使用。新成员由统一账号管理员创建一次。
- AI平台普通登录入口、登录超时入口、顶部互跳都走统一身份流程。AI平台本地账号密码登录不能建立我方登录会话，必须在切换后停止作为普通登录入口。
- 我方已登录：点击顶部“全球电商AI经营平台”，到对方 `/admin/?sso=1`；对方必须发起 OIDC，即便已有本地会话也确认一次当前统一身份。我方复用登录会话，不再要求密码或个人 key；对方随后进入无参数的 `/admin/`，避免同浏览器残留旧账号。
- AI平台先登录：跳转我方统一登录页输入统一账号，认证后返回AI平台并建立其本地会话，同时已建立我方会话；此后打开我方系统即可进入。
- 两边分别持有自身的安全会话，不跨域写 Cookie 或 localStorage，不共享用户密码。

浏览器必须是同一配置文件且允许第一方 Cookie；隐身窗口、不同浏览器不共享登录。统一认证依赖我方可用性；不可因认证故障降级为绕过身份校验。

## 2. 客户端注册与地址

| 项目 | 固定值 |
| --- | --- |
| issuer | `https://is.luckdate.com/api/identity` |
| discovery | `https://is.luckdate.com/api/identity/.well-known/openid-configuration` |
| client_id | `chatviva-admin` |
| client_secret | 我方部署人员通过安全渠道交付，保存在对方后端环境变量 |
| redirect_uri | `https://ai.chatviva.com/api/auth/oidc/callback` |
| response_type | `code` |
| grant_type | `authorization_code` |
| scope | `openid profile platform_access` |
| 客户端认证 | `client_secret_basic` |
| PKCE | 强制 `S256`，所有登录均启用 |
| ID Token签名 | `RS256`，从 discovery 的 `jwks_uri` 获取公钥 |
| 登录后页面 | `https://ai.chatviva.com/admin/` |
| 我方入口 | `https://is.luckdate.com/admin/` |

回调地址必须完整一致，不能使用通配符、前端hash路由或把任意 `return_to` 作为回调。修改回调需双方同步注册。客户端密钥是系统级凭证，全部用户共用一份后端配置，用户无需获取或输入。

以下路径用于说明，客户端应优先读取 discovery，避免拼接端点：

| 用途 | 路径与方式 |
| --- | --- |
| 授权 | `GET /api/identity/auth`，浏览器顶层跳转 |
| 换取令牌 | `POST /api/identity/token`，后端调用 |
| 用户信息 | `GET /api/identity/me`，`Authorization: Bearer <access_token>` |
| 公钥 | `GET /api/identity/jwks` |
| 在线有效性 | `POST /api/identity/token/introspection`，Basic客户端认证、表单 `token` |
| 撤销令牌 | `POST /api/identity/token/revocation`，Basic客户端认证、表单 `token` |
| 统一退出页面 | `GET /api/identity/logout`，用户确认后同源POST退出 |

本版不提供密码授权、隐式授权、动态客户端注册或 Refresh Token。统一退出是本项目的确认页面，不是 OIDC RP-Initiated Logout，discovery 不公布 `end_session_endpoint`。

## 3. 对方实现登录流程

1. 未登录访问 `/admin/`，后端创建随机 `state`、`nonce`、PKCE verifier/challenge，全部至少256位随机。将其与发起登录的浏览器绑定，存后端临时会话，5分钟过期、单次使用。浏览器绑定 Cookie 使用 Secure、HttpOnly、SameSite=Lax；不能使用 Strict，否则跨站回调可能丢失绑定。
   访问 `/admin/?sso=1` 时无论是否已有本地会话，都必须先发起上述身份确认，并在成功回调后切换为已确认的账号；认证失败时不能展示旧账号数据。参数只是发起确认，不携带身份或凭据，不能被当作已登录标记。
2. 顶层跳转 discovery 的 `authorization_endpoint`，携带 `client_id`、完整 `redirect_uri`、`response_type=code`、scope、state、nonce、`code_challenge` 和 `code_challenge_method=S256`。
3. 我方检查现有会话或显示统一登录页。部分跨域跳转会经过同源自动衔接页，这是为了保留我方普通会话的 SameSite=Strict 设置。不要改为 iframe，也不要用跨域AJAX调用授权端点。
4. 回调首先核对并消耗浏览器绑定的 state；没有临时会话、state不符或过期即拒绝，不能接受主动提交的 code。
5. 对方后端以 Basic 客户端认证提交表单：`grant_type=authorization_code`、code、完整 redirect_uri、code_verifier。客户端密钥不发送给前端。
6. 由标准库验证 ID Token 签名、RS256算法白名单、准确 issuer、audience/azp、exp/iat和原 nonce。校验授权响应的 `iss`；拒绝不一致。未知 kid 刷新JWKS，仍未知即拒绝，不能跳过签名验证。
7. 使用 `(iss, sub)` 查询或创建对方账号，按下一节分配权限，再建立对方自己的登录会话。回调响应立即303跳转到固定 `/admin/`，不要把 code/token 留在页面、日志或前端URL中。

Node.js `openid-client` 6.x 核心调用示意，省略框架相关的临时会话和响应写法：

```js
import * as oidc from 'openid-client';

const config = await oidc.discovery(
  new URL('https://is.luckdate.com/api/identity'),
  'chatviva-admin',
  process.env.IS_OIDC_CLIENT_SECRET,
  oidc.ClientSecretBasic(process.env.IS_OIDC_CLIENT_SECRET),
);

// 登录发起：pending必须存后端，绑定当前浏览器且单次使用。
const verifier = oidc.randomPKCECodeVerifier();
const state = oidc.randomState();
const nonce = oidc.randomNonce();
const challenge = await oidc.calculatePKCECodeChallenge(verifier);
const url = oidc.buildAuthorizationUrl(config, {
  redirect_uri: 'https://ai.chatviva.com/api/auth/oidc/callback',
  scope: 'openid profile platform_access',
  state, nonce,
  code_challenge: challenge,
  code_challenge_method: 'S256',
});
// await savePendingForBrowser({ verifier, state, nonce }, 300);
// response.redirect(303, url.href);

// 回调：pending必须从当前浏览器的临时会话获取并原子消耗。
// const pending = await consumePendingForBrowser();
// const callbackUrl = new URL(实际回调URL，固定可信域名);
// const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
//   pkceCodeVerifier: pending.verifier,
//   expectedState: pending.state,
//   expectedNonce: pending.nonce,
// });
// const claims = tokens.claims();
// await resolveAuthorizedAccount(claims.iss, claims.sub, claims.ai_role);
```

注意：上述示例不是可直接上线的完整服务。临时会话的原子消耗、账号唯一约束、权限检查、有效性复查和本地会话建立是必需实现项。使用其他语言时保持同样的协议与校验。

## 4. 身份与权限

已验证的 ID Token / UserInfo 包含：

```json
{
  "sub": "<统一账号UUID>",
  "name": "<姓名>",
  "preferred_username": "<当前账号名>",
  "selection_role": "admin",
  "ai_role": "researcher"
}
```

`iss`、`aud`、`iat`、`exp`、`nonce` 由 ID Token 提供。`name` 和 `preferred_username` 仅展示，可能修改；没有手机号/邮箱验证声明，不能根据这些字段自动合并历史账号。统一ID采用我方账号ID，改名后不变。

所有启用的我方管理员/研究员按约定可进入AI平台，默认 `ai_role=researcher`。仅我方管理员且其UUID被运维加入 `IDENTITY_AI_ADMIN_USER_IDS` 时，才签发 `ai_role=admin`；对方需将两个值映射到本地明确的权限集合。不能把 `selection_role=admin` 当作对方管理员授权。若对方没有researcher角色，应创建对应低权限角色；未识别角色或无可用映射时拒绝登录。

对方数据结构至少需要：`issuer`、`subject`、`local_user_id`，对 `(issuer,subject)` 建立区分大小写的唯一约束。已有账号停用时必须拒绝登录，不因SSO重新启用。已建立身份对应关系不得被后续登录自动改指其他本地账号。

新身份首次登录可事务内自动创建本地账号并保存唯一对应关系；并发首次登录须复用同一个账号。角色依据本次已验证的 `ai_role` 同步，降权必须生效，不允许保留已撤销的管理员权限。此对应关系由系统写入，用户不操作。

## 5. 现有账号一次性迁移

我方的旧账号无须迁移到新ID；它们已经是统一账号。AI平台的旧账号不能无依据自动认领。

1. 我方管理员在“账号与管理”导出统一账号目录。后端接口为 `POST /api`，JSON `{"action":"auth_identity_directory"}`，仅我方有效管理员Cookie可调用。返回 issuer、sub、username、name、enabled和权限，不含密码/个人key/会话。
2. 双方管理员根据现有人员名单确认旧账号所属；对方管理员批量导入 `issuer, subject, existing_local_user_id`。导入前提供预览，检查同一身份多账号、一个旧账号被多人认领、停用账号及权限冲突。整体冲突回滚，输出审计结果，不能按姓名/未验证用户名盲匹配。
3. 对方独有成员由统一账号管理员批量创建统一账号，分配初始密码并通过安全渠道送达，再一次性迁移原本地账号。不要导出或同步密码哈希；本版不提供匿名自动注册或外部任意创建管理员接口。
4. 对方关闭旧普通密码登录入口，撤销切换前的旧会话，将入口切到 OIDC。用户以后只用统一账号，不再逐人操作key。尚未确认的旧账号不自动继承其业务数据或高权限；由管理员先补齐迁移再放行，避免重复账号。

目录含人员信息，仅在管理员之间安全传输，禁止提交到Git或作为公开静态文件。对方如保留应急本地管理员，应独立限制入口，不能将该入口宣称为已建立统一登录。

## 6. 会话、有效性与退出

- 授权码60秒、交互5分钟；ID Token和Access Token均5分钟，不签发Refresh Token。
- 我方普通会话绝对12小时、空闲30分钟；OIDC会话绑定原我方会话，不能绕过该空闲/绝对有效期。
- 对方必须在每个受保护请求检查本地会话；访问令牌到期时重新走顶层授权。需要较快响应停用/改密/退出时，后端调用 introspection，有效性缓存最长60秒，高权限写操作每次检查；失败或 `active:false` 时失效本地会话，不能仅解码旧ID Token无限续期。
- 我方退出、改密、重置密码、停用或改权限会撤销相应账号的授权码、令牌及OIDC会话。已签发JWT本身不能被修改，所以对方不能仅依赖离线签名推断仍可访问。
- 我方退出后保留其他设备的我方普通会话，但撤销该用户全部OIDC凭据；其他有效设备下次授权会重新建立OIDC会话。
- AI平台“退出”先清除自己的本地会话，再顶层打开 `https://is.luckdate.com/api/identity/logout`。用户确认退出后清除当前我方会话并撤销OIDC凭据；取消统一退出仅退出AI平台。
- 未提供即时反向注销推送；对方会话依靠上述在线检查和5分钟令牌上限失效。两边退出实时同步不能仅靠这版离线ID Token实现。

## 7. 错误与重试

| 错误 | 对方处理 |
| --- | --- |
| `login_required` / `consent_required` | `prompt=none`探测失败，改为普通顶层登录，禁止循环静默重试 |
| `invalid_client` | 核对client_id/secret和Basic认证，记录脱敏错误 |
| `invalid_grant` | code过期、重复、PKCE或回调不一致，清除临时流程后重新发起 |
| `invalid_request` | 核对PKCE、参数及回调完整值，不降级安全检查 |
| 401 / `active:false` | 清除对方会话并重新认证 |
| 429 / 503 | 有限退避后由用户重试，不能重放已消费code |

我方按来源每分钟限120次身份请求，状态变更使用数据库互斥锁；忙时返回503。调用超时应重新发起授权流程，不能无限重试同一个code。日志只记录请求ID、错误码与脱敏身份，禁止记录密码、client_secret、Cookie、code和token。

## 8. 我方部署配置与切换

仅供我方部署人员：

```sh
node server/identity-keygen.mjs /private/path/outside-repository
```

生成 `identity.env` 与给对方后端的 `chatviva-client.json`，不打印密钥、默认不开启。Windows需要由运维限制目标目录ACL，文件mode不能代替Windows权限控制。既有 `PROVIDER_CONFIG_ENCRYPTION_KEY` 保持不变，不得覆盖数据库加密密钥。

- `IDENTITY_ENABLED=true` 才启用本版；默认false。
- `IDENTITY_PUBLIC_ORIGIN=https://is.luckdate.com`，必须为完整HTTPS origin。
- `IDENTITY_AI_CLIENT_SECRET` 为客户端后端密钥；与对方同时配置。
- `IDENTITY_COOKIE_KEYS` 为JSON数组，持久保存，轮换时新值放首位并暂保留旧值。
- `IDENTITY_SIGNING_JWKS` 为包含私有RSA签名密钥的JWKS；持久保管，轮换保留旧公钥对应密钥至旧token过期；JWKS公开端点只返回公钥。
- `IDENTITY_AI_ADMIN_USER_IDS` 默认 `[]`，仅按已确认的管理员名单配置。
- `identity_artifacts` 是新增数据库表，包含加密的授权状态和哈希索引；接入原迁移表清单。发布前按schema变更准备备份和恢复方案，保护现有业务/认证数据。
- 反向代理沿用 `/api/*` 转发；私有后端端口不能公网暴露。由可信网关覆盖转发IP，禁止客户端伪造 `X-Server-Key`/来源IP；HTTP头和请求体中均不得记录凭据。
- 启用本版时我方自动关闭个人key和旧管理员SSO路由；前端不再出现个人key控件。旧表不删除，回退可恢复原配置。

切换顺序：双方备份配置和账号迁移记录 → 我方集成部署代码且开关暂关闭 → 安全交付客户端密钥 → 对方完成客户端及管理员批量迁移 → 串行配置双方开关和普通登录入口 → 使用约定低权限QA账号做双向浏览器验收 → 验收后扩大使用。切换/正式发布需单独授权。

回退：停用统一开关、对方撤销新本地会话并恢复上一登录入口、我方恢复原SSO配置；不回滚或删除业务数据、不删除统一账号ID。保留身份表用于审计，清理有效凭据时按账号/应用范围操作，不重放旧授权码。

## 9. 联调验收清单

1. 清空两站Cookie，从我方登录后点击AI入口，首次自动开户/迁移命中，第二站不出现密码或key输入。
2. 全新浏览器从AI入口走统一登录，进入AI后打开我方，无需再次输入密码。
3. 同浏览器两位用户切换、多标签、回退/刷新/重复callback，不串号、不重复创建账号。
4. 程序重启后会话和公钥稳定，已发授权码只可消费一次；并发兑换最多一次成功。
5. 错state/nonce、错误aud/issuer/签名、无PKCE、错误verifier、回调篡改、code重放、跨站表单、停用账号均拒绝。
6. 默认AI低权限，我方管理员不自动升级AI管理员；显式允许/撤销后按在线检查生效。
7. 改名保持sub；改密/停用/退出后，令牌和对方会话按约定窗口失效；空闲30分钟不能由OIDC绕过。
8. 旧账号业务数据保留；迁移冲突不会覆盖现有身份；未迁移旧账号不能被同名账号认领。
9. 实际浏览器跨域Cookie、桌面/手机布局、网络失败和503恢复均验证；HTTP协议测试不代替正式双向浏览器验收。
