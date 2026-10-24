# 与远程连接项目的接口约定

版本：0.1-draft，2026-10-23。这是待实现的联合契约，不是DSH现有API声明。

## 权威与分工

远程侧契约文件：dsh-remoteconnect/docs/WORKBENCH_INTEGRATION.md。
本文件记录工作台消费要求；公共接口以远程侧实现后的版本化声明为准。当前两个文件均为设计草案。

Remote Connect负责连接、配对、凭据、Peer、重连和通用扩展调用/流。
工作台负责项目/任务/Run/记忆/主助理、业务幂等、领域cursor和持久Outbox。
DSH负责真实Agent与Session生命周期、工具权限和原始执行日志。

## 安装与启动

Mac同装远程Client与工作台Client；Windows同装远程Host与工作台Host。可由依赖/安装指引协助，不默认安装其他任务板。

工作台LocalProvider在Windows本机连接当前Domain；RemoteProvider在Mac选定Windows连接后调用同一Domain。用户不会因为切设备而建立另一份主助理或任务库。

远程插件不可用时显示连接缺口，可测试LocalProvider，但不把Mac本地执行当降级替代。工作台在远程插件安装前可以完成本机开发。

## 拟定的公共能力

这些名称仅是逻辑契约，实现时统一导出名称并生成类型：
- identity：稳定hostId、profileId、DSH版本、连接协议版本、serverEpoch；
- state：disconnected/connecting/auth_required/ready/recovering/error；
- capabilities：列出支持的session、interaction、file、extension调用与stream能力；
- extension.invoke：按已注册且有schema的扩展端点调用；
- extension.follow：按已注册端点打开可取消的业务流；
- session adapter：list/read/resume/send/interrupt；
- interactions：同一Peer接收并回答审批/提问；
- file adapter：上传、下载、预览与远端目录。

工作台不能从远程服务取得长期凭据，也不持有浏览器Cookie。Client只保存非秘密connectionId。认证与网关状态由连接插件维护。

## 工作台扩展端点（拟定，不是DSH方法名）

由Windows工作台注册：
- project list/read/bind；
- task list/read/create/update/split；
- batch start、run read/interrupt/reconcile；
- assistant read/send、pending interaction projection；
- domain follow、result read、artifact access。

所有写命令带clientRequestId，涉及并发更新带expectedRevision。真实wire名称按DSH生成描述符与选定底座映射，不使用字符串拼接调用任意Host对象。

输入引用至少标明connectionId对应的hostId/profileId、projectId/taskId；Host重新校验，不能信任Client标题和路径。

## 数据与恢复

领域流由工作台定义baseline + sequence/delta或journal cursor。远程插件只承载，不推断任务是否完成，不把普通Host通知当持久记录。

连接generation变化时工作台：
1. 失效旧异步响应；
2. 确认host/profile身份；
3. 重建follow订阅后读取baseline/追赶；
4. 回读Run、待处理交互和主助理当前绑定；
5. 按clientRequestId对账未确认提交，不自动重发副作用。

Mac关闭仅结束观察。Windows已accepted的Run由工作台调度器和DSH持有，不绑定Client的AbortSignal。用户明确Stop是独立命令。

二进制附件与文件流保持DSH相应codec，不可JSON.stringify后损坏bytes。所有业务路径按Windows解释。

## 错误与版本

最少区分auth_required、offline、unsupported_version/capability、conflict、unknown_outcome、cancelled、domain_error。

远程协议版本与工作台Domain版本分别协商。扩展未加载、schema不兼容、缺审批能力时明确拒绝相应操作；不静默改用Mac本地。

## 联调样例

先由远程项目使用独立stub注册echo+counter+follow，证明扩展可承载。
再由工作台使用一个隔离Project和两张依赖任务：
Mac引用A/B→Windows创建同一batch→A执行→结果落盘→B解锁→Mac断网→Windows继续→Mac恢复读取相同IDs。

双方都记录版本和脱敏correlation ID。Stub通过只证明接口；真实Mac+DSH执行是最终验收。
