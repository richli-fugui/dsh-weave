# ADR 0003：公开扩展通路与原生请求应答

2026-10-26。候选 0.1.3；验证层次见最新 handoff，不由本文推断已部署。

采用 Remote Connect 0.1.19 已实现的 Node 公共服务：Windows 的 remoteconnect 服务提供 host.server.registerExtensionMethod；Mac 的 remoteconnect_client 提供 invokeExtension。源码与已安装 0.1.19 对照了 adapters/dsh.js、host/index.d.ts、connector/index.d.ts、connector/service.js。原 WORKBENCH_INTEGRATION 草案不再作为已经实现的 API。

Windows 注册 workbench.api.v1，只接收白名单中的工作台业务路由并复用同一组领域处理器。Mac Node 只将本机界面请求转送到当前已验证的 Remote Connect 连接；不读取凭据、不另建网关、不打开 SQLite、不播种项目、不注册执行工具。Mac 默认 client，显式 host 配置被拒绝；断线或代次变化不回退、不自动重发写操作。旧 RemoteProvider 保留其逻辑契约测试，不冒充产品入口已使用该类。

这保持原有面板与单一 Windows 领域权威，代价是短轮询与一个很薄的路由信封。信封 version=1，按 method/path 白名单匹配，body 上限 1MiB；诊断、任意对象调用及 runs/complete 不通过该通路。连接身份/代次在前后复核，旧响应丢弃。Remote Connect 默认调用超时为 15 秒；长回合超时不表示 Windows 没受理，Mac 应继续读取聊天/控制状态，不能重复发送同一工作。后续可将长回合改为持久受理回执，但不能偷偷加重试。

当前安装目标文件为官方 DSH 0.2.1-rc.3。已核对 dsh-user-questions/lib/types/index.js、dsh-user-approval/lib/types/index.js 以及 dsh-api-remotes/lib/types/remote-events.js 的公开事件：user-questions/request、approval/request。问题 waterfall 返回结构化 answers；批准返回 allowed-once，拒绝返回 rejected。不存在本轮可依赖的通用 interactionController 服务，不能照抄审查建议的方法名。

工作台只截获其正在跟踪的精确根 Session 的请求，其他请求继续交给下一位 answerer。保留宿主 callId/approval asked id，回答时同时核对所属 Session、主回合 requestId 和请求 ID，直接结算原 Promise；不再发送 followup 冒充作答。tracker 的请求 ID 也传给宿主 prompt。卸载/取消关闭当前请求，旧按钮失效。原生问题跨重启后的 continued-question 恢复仍需后续适配，不能假装丢失的 Promise 仍可答复。

unknown 的 Worker 手工对账原已存在；主助理本轮增加显式放弃。必须由用户确认原宿主已退出并匹配准确轮次，原子保存审计、清 pending、换新会话绑定；记录 terminationVerified=false，不声称真的取消了失联工具，不按超时自动解除保护。
