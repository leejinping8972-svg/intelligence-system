# Google Trends Cookie、限流和网络超时

Cookie页面的200/429响应均提取Cookie并尝试数据接口，不因HTML页面429自动冻结整个域名。响应以`RateLimit-Scope`或`X-RateLimit-Scope`明确标记global/service/account时，停止链路并交给持久趋势队列遵守等待时间。Cookie、组件token不写入诊断日志。

正式趋势采集使用`collectTrendPart`与持久`google-trends:gate`：数据接口429有正数Retry-After时按其等待（支持秒数/HTTP日期）；无等待时间时依次5/15/30/60秒，随后保持60秒。最多5次自动重试及24小时期限保持，成功重置连续限流次数；正常成功间隔和非429网络故障策略保持。可选区域/相关查询429保留已取得曲线，同时冷却后续趋势请求。

Google请求使用`scheduledFetch`的可选调度配置：获得发送时隙后才创建15秒网络超时信号；调用者取消信号通过AbortSignal.any保留。其他采集来源默认调度、同域429至少60秒策略不变。日志按Cookie页面/趋势探索/曲线/区域/相关查询区分HTTP状态、排队等待和网络超时；读取响应体超时亦记录对应阶段。

无schema、业务迁移、启动修复、依赖或读模型版本变化。现有任务检查点和请求journal继续沿用，不回放未知收费请求；不会把失败任务自动改成成功。

开发验证：相关Node测试68/68通过，包括等待长于网络超时后发送成功、真正慢请求超时、取消信号、200/429 Cookie链路、明确服务级限流、Retry-After、短冷却、成功重置、附加接口限流曲线保留、队列恢复和增长计算；Node语法、diff检查、新测试及provider局部lint通过。其他既有文件的全量局部lint仍有原有规则问题，未记为全仓lint通过；无前端变更，未重复Web类型检查。

2026-11-10从正式API容器运行隔离候选采集模块，只进行有界免费Google读取，不写业务/重跑任务：Curcumin、Frankincense、Astaxanthin的6次采集均成功；各52个周点、92个日点，年趋势含区域/相关查询，30日变化分别-15.7%、+4.0%、-11.2%。Cookie页面均429，后续explore/multiline均200，单次0.66–3.67秒。实测是该时点的可用性证据，不保证Google永不再次限流。原始脱敏阶段记录在本功能树.artifacts/live-probe.jsonl。
