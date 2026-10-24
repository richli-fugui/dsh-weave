# 20261023-2133-execution-safety：防重复执行、保守恢复与停止回执

## 1. 身份与输入

- 项目：dsh-table；实际根目录为用户指定的workspace/dsh-table。未修改其他项目。
- Agent：Codex；不推断不可见的实际模型ID。
- 开始：2026-10-23T21:34:48+08:00；结束：2026-10-23T21:55:05.605+08:00（Asia/Shanghai）。
- 上轮：[20261023-2200-remote-contract](20261023-2200-remote-contract.md)。轮次ID是标签，以LOG追加顺序与实际时间为准。
- Git无提交、全部untracked，先读源码/包哈希；输入包SHA-256 1E1485E709A3E0A0050AF720630125F96FD668FE7AF4218779F55EEB235AB671。
- 写入前独占CreateNew创建.active.json，owner=codex-execution-safety-20261023。范围为本项目调度/领域/Provider/控制展示、必要测试、打包及交接；没有真实profile部署。
- 对应T3：修复有副作用的重放和崩溃窗口，保留正确的上轮改动。

## 2. 上轮独立审核

| 上轮主张 | 本轮复核 | 结论/动作 |
| --- | --- | --- |
| 包与RemoteProvider契约修改已经存在 | 输入包哈希一致；remote.ts A51364BA…、lib/providers/remote.js E7082EE6…与记录一致；既有契约测试复跑 | 成立，源码保留 |
| 常规全量60项=59过+1跳过 | 初始基线实际重跑同样结果 | 数量成立，但不证明纯离线、HOST或REMOTE |
| generation变化可隔离旧事实 | 原测试仅检查订阅被dispose。新增可复现adapter：invoke悬置→generation变化→旧请求返回 | 部分成立；旧invoke仍成功返回，T-011a FAIL |
| 协商失败/错误分类可靠 | 身份端点抛一般backend错误→ensureNegotiated把DOMAIN_ERROR视作兼容→业务写调用计数1 | 不成立，T-011b FAIL。未扩张本轮源码范围去改远程模块 |
| 幂等、恢复安全 | 原幂等只用无scheduler的LocalProvider检查Run行数。实际调度重放会再次调用executor；启动恢复把所有running/stopping退回todo | 不成立，已修；最初8个新回归在旧lib全部失败 |
| 真实模型门禁防止常规回归消耗 | host_ai套件确有门禁，但work_control_e2e若干apply未传测试模型配置，会自动读本地配置/请求8787 | 部分成立，常规E2E已隔离。早期基线可能已调用原端点，未记录确切调用/消耗，不伪称零模型调用 |
| T-008私有运行时绝对路径需中性化 | 产品明确要绑定现有Windows项目文件夹；运行时路径非公开材料 | 不是必须整改项，取消不必要用户决策。实际数据库未改 |
| 原profile已加载当前版本/完整闭环 | 上轮自己承认未重启；Node require不证明真实宿主加载 | NOT_RUN，新候选本轮不部署、不冒充生效 |

上轮连续性代码和契约改动保留。早期“L2/Gate全通过”与实际证据不符，本轮重写STATUS/ACCEPTANCE摘要，历史报告通过轮次文件保留。

## 3. 实现与理由

| 文件 | 变化 | 理由与取舍 |
| --- | --- | --- |
| src/host/services/domain.ts | admitRun原子返回created；验证请求绑定；队列领取与Run写同事务；重启未决→unknown、任务blocked、Outbox提醒；孤立started队列→unknown；批量取消事务；Run变更推进Task revision；拒绝旧interrupted完成覆盖 | created=false不是再次执行许可；DB失败不能吞掉。沿用schema3，无迁移和新依赖；缺上游可验证执行身份时宁可待核对，不能宣称恢复完成 |
| src/host/services/scheduler.ts | 重放只返回已受理Run；先持久化后入内存；领取走admitRun；同项目unknown保护、其他项目继续；停止中落盘、延迟退出后intent收敛；停止失败/unknown如实返回；队列领取错误保留待处理 | 保持主回合与后台分离；不会因为假定旧worker死亡而重做副作用。还缺真实worker对账，T-012明确留开放 |
| src/providers/local.ts | 单卡保留原clientRequestId，兼容旧版task后缀Run；正确返回队列身份 | 修正API业务键与实际落库不一致；不自动重试不明副作用 |
| src/shared/types.ts、src/client.tsx、src/index.ts | 可选unknownCount，控制条待核对；实际打包纯函数区分已停止/等待/冲突；聊天停止回执同样准确 | 不能服务端waiting_tool_exit但前端告诉用户“已生效中断全部” |
| tests/execution_safety.test.mjs | 13项：执行副作用次数、运行重试、绑定冲突、恢复、事务失败、孤立旧队列、真实Node子进程退出、旧结果、新请求、取消失败、延迟停止、旧键、打包前端回执 | 包含磁盘计数与子进程故障，替身执行器仍不是DSH Agent |
| tests/work_control_e2e.test.mjs | 显式本地HTTP模型替身+测试key；崩溃样例无关队列改为其他项目，并断言旧工作unknown；停止断言按真实状态 | 不用真实模型掩盖控制测试；同项目有不明写入时保留保护，不能为旧断言去取消保护 |
| tests/scheduler_context.test.mjs | 引用Revision与实时领域数据比对 | 执行状态变更应推进CAS版本；固定Rev=1是旧测试假设 |
| scripts/audit-remote-boundaries.mjs | 两项独立远程边界反例；发现FAIL退出1 | 将本轮不同意见变成可复现证据，不篡改绿的回归数量 |
| handoff、docs、evidence | 更新状态、验收、轮次、版本、失败证据 | 下一位不需要聊天上下文 |

运行成本：无新增包依赖。unknown保护当前仍需要后续上游对账；不自动解除保护，不读取真实业务数据。
回滚：本轮未部署，原安装不受影响；输入tarball备份在.artifacts/execution-safety/input-dsh-table-0.1.0.tgz。源码回退需按本轮文件差异做选择性撤回，不能reset整个未提交工作树。未来部署产生unknown后，旧版不具备同等保护，不能直接用旧版重启接管不明执行。

## 4. 实际验证

| 用例 | 层 | 命令/结果 | 结论 |
| --- | --- | --- | --- |
| 原始基线 | UNIT/旧测试可能访问真实桥接 | npm test，退出0，60项=59过1跳过 | 数量成立，非HOST/MODEL验收 |
| 新回归检查旧lib | UNIT/MOCK | node --test tests/execution_safety.test.mjs，退出1，初始8项全部失败 | 成功检出旧缺陷；部分失败含新API缺失，不能全部解释为同一缺陷 |
| 第一次修后 | UNIT/MOCK | 专项7过1失败 | 子进程用例清理先删目录后关DB，Windows EPERM；修正after清理顺序后通过 |
| 新专项最终 | UNIT/MOCK | 13/13通过，后续全量也包含这13项 | PASS |
| 全量最终 | UNIT/MOCK | npm test，退出0，73项=72过1跳过；TEST_REAL_LLM=false、测试key和不可达默认URL防外泄，实际用例显式本地HTTP替身 | PASS（限定程序层） |
| 静态 | STATIC | npm run build、npm run typecheck均退出0 | PASS |
| 子进程崩溃 | 程序故障注入 | 已领取队列并持久化Run→executor写一次磁盘记录→process.exit(73)→重开DB、重放旧/新键 | 状态unknown、计数仍1，PASS；不是DSH Host崩溃证明 |
| 包加载 | UNIT/MOCK | 解包后从包内导入，60个lib文件逐一相同；两次同请求executor次数1 | PASS；不是HOST加载 |
| Remote边界 | UNIT/MOCK | node scripts/audit-remote-boundaries.mjs，退出1 | **2项FAIL，T-011待修** |
| MODEL完整验收/HOST/DESKTOP/REMOTE实机 | 对应真实层 | 本轮未独立运行/未部署 | NOT_RUN；Mac BLOCKED |

原始日志在.artifacts/execution-safety/（Git忽略，本地查错用）；公开摘要在evidence/，不含用户任务正文/凭据。
不能把全量测试绿解释为已知Remote缺陷消失。

## 5. 版本与部署

- 输出包SHA-256：DEB1558A717440416DE57FE853CD4042122F64165D2486B2C83E7A2B5317B831。
- 最终源码哈希、输入/输出包、命令退出码见[版本证据](../../evidence/execution-safety-20261023.json)。
- 包名/版本沿用dsh-table@0.1.0；未发布。
- HOST安装/运行时加载：NOT_RUN。没有把lib热复制到用户正在使用的desktop profile，未重启或强杀任何进程。
- 只读检查既有安装scheduler.js哈希 E923CB23F3CC0D8D18E97E26C445C0C4C3EC1300643C4CAD3854D82176BC2A6C；这不是新候选的部署证据。
- 未读取/打印私人凭据文件；旧测试的隐式配置读取风险已如实说明并隔离。没有修改workbench.db或迁移实际绑定。

## 6. 开放问题与下一位

1. **第一条动作**：运行 node scripts/audit-remote-boundaries.mjs。按T-011修复代次变更后的invoke/协商/follow状态：迟到写不能谎称未执行，身份未知不能静默放行。将反例纳入正常回归。
2. T-012：建立可验证worker受理身份与真实查询/停止/结果对账，给unknown提供安全恢复，不让用户手工改SQLite。
3. T-009/T-002：安装新候选到隔离真实DSH宿主，取正确版本、材料读取、工具/权限和办公成果证据，再决定原实例部署。
4. T-007/T-006及真实Mac：本端边界可靠后再联调公开契约和实际桌面。
5. 真实模型预算、真实设备缺席时只阻塞相应层；当前无需用户重启旧包或决定数据库中性化。

## 7. 交接自查

- [x] 已独立审核上一轮，保留成立修复并留下反例。
- [x] 已记录实现、理由、失败和未完成范围。
- [x] 已更新STATE、LOG、STATUS、ACCEPTANCE，历史轮次保留。
- [x] 证据分层、候选版本和未部署状态清楚。
- [x] 保留他人工作；仅释放本轮自有占用；未commit/push/发布。
