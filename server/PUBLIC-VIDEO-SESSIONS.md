# 公共内容视频观看与下载渠道核验

核验日期：2026-11-12。功能范围为浏览器中的平台会话复用；下载渠道只核对官方文档与公开 OpenAPI，未发起收费详情/下载请求，未接入 OSS。

## 观看方式

- 公共内容详情使用常规 `www.youtube.com/embed`，由浏览器决定是否携带可用的平台 Cookie。第三方 Cookie、地区、平台验证与视频本身的嵌入限制仍可能阻止播放；iframe 的 load 事件只表示页面加载，不表示登录成功或视频可播放。
- 用户可通过“在 YouTube / TikTok / Instagram / Facebook / Reddit 观看”打开平台的第一方页面，由本人完成平台登录。同一浏览器配置中的有效平台 Cookie 由浏览器自动复用；系统不读取、导入、上传或保存平台密码/Cookie。
- 平台窗口打开前断开 `window.opener`。浏览器随后禁止系统再次导航该跨域窗口，因此不同视频打开新的平台页面，并通过同一浏览器的 Cookie 复用登录；当前平台最近打开的同一视频可直接聚焦已有窗口。窗口关闭或 COOP 使引用失效时重新打开。平台再次验证、登录过期、清除 Cookie、无痕窗口或更换浏览器时可能需要重新登录。
- 使用平台窗口后，只将该平台的观看偏好 `inline` / `platform` 写入 `hci-public-video-mode:v1:<platform>`，后续同平台视频优先使用此方式；这不是登录标记。可点“尝试内嵌预览”恢复详情预览，或“刷新预览”重新挂载播放器。
- 结果卡片与详情底部的原平台链接共用平台会话复用逻辑，Ctrl/Cmd/Shift/Alt 与中键操作保留浏览器行为。窗口被拦截时保留普通链接作为后备入口。文章与其他非视频内容保持原有阅读方式。

## 当前渠道是否提供视频文件

| 平台 | 当前采集路径 | 已核验的下载能力 | 对保存到 OSS 的影响 |
| --- | --- | --- | --- |
| YouTube | Google YouTube Data API 搜索、详情；ScrapeCreators 字幕 | 当前搜索/详情不提供视频文件下载。ScrapeCreators 明确不提供托管 YouTube 下载 API，另有开源自建下载器。 | 不能直接把现有页面链接当视频存入 OSS，需要另建下载服务。 |
| TikTok | ScrapeCreators 关键词搜索 | `/v2/tiktok/video` 返回 `aweme_detail.video.download_addr`、`download_no_watermark_addr` / `play_addr` 等地址；是否存在及是否含水印取决于来源实际返回。`download_media=true` 可代下载并返回其托管存储地址。 | 渠道具备下载能力，需新增逐条详情解析、下载及 OSS 写入流程；当前系统未接入。 |
| Instagram | ScrapeCreators Reels 搜索 | `/v1/instagram/post` 返回 `data.xdt_shortcode_media.video_url`。`download_media=true` 可代下载并返回其托管存储地址。 | 渠道具备下载能力，需新增逐条详情解析、下载及 OSS 写入流程；当前系统未接入。 |
| Facebook | ScrapeCreators 视频搜索 | `/v1/facebook/post` 对可用视频返回 `video.sd_url` / `video.hd_url`。 | 可用文件地址可以作为另建下载/OSS 流程的输入；当前系统未接入。 |
| Reddit | ScrapeCreators 搜索与帖子详情 | 已读详情规范主要描述帖子元数据，未确认承诺可下载的视频文件字段。 | 本轮不记为已支持。 |

TikTok、Instagram 的 `download_media=true` 官方参数说明：找到媒体时 10 credits，未找到时 1 credit；这是返回渠道托管地址的选项，不是直接上传用户的阿里云 OSS。普通详情接口本身也可能计费。CDN 地址的期限、地区及下载可用性以具体响应为准，不能由文档推定每条已采视频都能下载成功。

本轮没有实际取得上述业务视频的文件、没有下载成功收据、没有上传或配置 OSS，未使用用户的平台 Cookie 向服务器发请求。

## 官方依据

- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [ScrapeCreators YouTube Video/Short Details](https://docs.scrapecreators.com/v1/youtube/video/)，规范：`/v1/youtube/video/openapi.json`
- [ScrapeCreators 开源 YouTube 下载器](https://github.com/ScrapeCreators/youtube-downloader)（本轮未部署/执行）
- [TikTok Video Info](https://docs.scrapecreators.com/v2/tiktok/video/)，规范：`/v2/tiktok/video/openapi.json`
- [Instagram Post/Reel Info](https://docs.scrapecreators.com/v1/instagram/post/)，规范：`/v1/instagram/post/openapi.json`
- [Facebook Post](https://docs.scrapecreators.com/v1/facebook/post/)，规范：`/v1/facebook/post/openapi.json`
- [Reddit Post](https://docs.scrapecreators.com/v1/reddit/post/)，规范：`/v1/reddit/post/openapi.json`

公开规范原文保存在本机 ignored `.artifacts/channel-download-check/`，不提交接口例子中的临时 CDN 参数或真实业务数据。验证使用合成视频、隔离浏览器与本机 API；不访问正式业务写入、真实平台账号或收费来源。
