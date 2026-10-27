# 统一身份功能交付与验证

日期：2026-10-27。功能分支 `codex/unified-oidc-sso-20261027`，基线 `b92502fb09742ce084a7e4519182cac2eab3f9ee`。

状态：我方代码完成，功能自测通过，待集成。未修改或推送共享 testing，未部署、修改正式开关或操作真实账号。对方新 OIDC 客户端尚待按 [开发文档](UNIFIED-SSO.md) 接入；本报告不代表正式双边验收完成。

## 实现范围

- `oidc-provider@9.13.0` 提供标准OIDC授权码、强制PKCE S256、RS256签名、discovery/JWKS、UserInfo、令牌内省与撤销。
- 统一身份复用我方现有账号ID、密码、停用/权限检查和登录限流；外部不提供密码授权。默认AI研究员，AI管理员按明确UUID名单授权。
- 授权状态加密入库并使用哈希索引，会话绑定原我方会话；进程内队列与数据库互斥保护授权码单次消费。改密、重置、权限变更与退出撤销OIDC凭据。
- 启用统一身份后关闭旧个人key/管理员SSO；前端改为统一状态和管理员迁移目录导出。顶部 `/admin/?sso=1` 要求对方确认当前统一身份，防止旧本地会话串号。
- 新增 `identity_artifacts` 表并接入数据库迁移清单；包含依赖锁、compose/Caddy配置及私有配置生成工具。正式发布时按schema变更准备备份与回退。

## 已执行

| 项目 | 结果 |
| --- | --- |
| 后端相关测试 | 65项通过，0失败、0跳过；包括真实OIDC库、HTTP、隔离PGlite SQL、实际现有auth模块，以及旧协议兼容回归 |
| 浏览器双向登录 | 1项完整场景通过；本机两个不同站点的HTTPS域名、临时证书、真实Edge浏览器和Cookie，隔离合成账号 |
| 关键安全断言 | 客户端密钥错误、回调篡改、跨站POST、强制PKCE及错误verifier、签名/issuer/aud/nonce、重放与并发兑换、停用/改密/退出撤销、目录权限、明文凭据不入库 |
| 会话场景 | 我方先登录→对方；对方先登录→我方；已有统一会话再次跳转；源账号切换后目标确认并切换；重建Provider后会话保持；30分钟空闲/12小时边界复用原auth检查 |
| 前端相关测试 | 20项通过；登录状态、旧SSO导航、个人key兼容行为 |
| 类型检查 | 完整Web `vue-tsc --noEmit --skipLibCheck` 和根目录 `pnpm check:type` 均通过；后者扫描38个包、实际1项typecheck任务成功 |
| 前端构建 | server/history/`/admin/` 模式独立production构建通过，产物在忽略目录 `.artifacts/unified-identity-build` |
| Lint | 新增身份模块/测试与独立设置组件的Oxlint、ESLint通过；session.ts、basic.vue专项ESLint通过；不声称全仓lint通过 |
| 配置工具 | 私有密钥生成、Node标准环境变量解析、配置校验和拒绝覆盖已有文件的冒烟检查通过；临时文件已清理 |
| 视觉检查 | 1280×800和390×844登录页截图已检查，真实logo加载、无横向溢出或文字重叠；截图在 `.artifacts/identity-browser` |

本机前端依赖通过目录链接复用，功能源码和构建产物独立；Vitest需测试专用配置将 `@vben/icons` 指到本功能目录并允许共享依赖路径。默认配置的首次运行曾因共享目录边界失败，使用 `.artifacts/identity-vitest.config.mts` 后20项全部通过，未修改生产Vite配置。浏览器测试发现并修复了临时Cookie前缀/路径、表单Origin与跨域回调CSP问题；最终真实浏览器场景通过。

首次提交钩子未通过：共用历史文件存在Oxlint错误，自动修复还引入了catch变量遮蔽并导致类型检查失败。已还原这轮钩子的整文件改动，修正新增组件的变量命名，重新完成上述专项检查和根目录类型检查。本次提交不记为完整提交钩子通过，不纳入无关历史格式修复。

## 复现

在已安装依赖的 `server/` 下运行：

```sh
node --test identity.test.mjs auth-performance.test.mjs admin-sso.test.mjs platform-link-store.test.mjs platform-link-proxy.test.mjs platform-link.integration.test.mjs
node --test identity-browser.test.mjs
```

浏览器测试需要OpenSSL和Chromium/Edge；可通过 `IDENTITY_TEST_OPENSSL`、`IDENTITY_TEST_BROWSER` 指定可执行文件。临时证书创建在系统临时目录并自动清理；只访问本机映射域名，不连接正式服务。协议测试使用实际auth模块和临时PGlite数据库，测试凭据运行时创建，不使用真实账号。

旧协议回归可通过 `HCI_TEST_PGLITE_MODULE` 指定已安装PGlite的绝对入口路径；本机已有独立测试运行时，65项结果没有跳过。

## 验证边界

- 尚未运行隔离MySQL集成、Docker镜像构建或完整CI；MySQL分支使用既有数据库包装和兼容SQL，不将PGlite结果记为MySQL验收。
- 浏览器对端是实现约定流程的本机合成客户端，验证Cookie、身份和跳转；不能证明对方真实平台的登录持久化、权限映射、旧账号迁移与注销复查已实现。
- 对方必须完成自己的state/nonce/PKCE、签名验证、唯一身份约束、自动开户/旧账号迁移、`sso=1`入口、会话建立和有效性检查，再做正式双向验收。
- 同一人旧账号缺少共同可信身份字段，需要管理员一次性批量核对；无法仅靠协议安全推断同名账号属于同一人。新统一身份不需要用户手动关联。
