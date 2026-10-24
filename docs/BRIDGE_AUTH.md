# 宿主 AI 桥接端点：鉴权与配置说明（脱敏）

建立：2026-10-23（轮次 20261023-2200-remote-contract）。本文只记录配置方式与排查入口，不含任何凭据值、token 或真实密钥。

## 端点

- 默认桥接端点：`http://127.0.0.1:8787/v1`（本机 WorkBuddy 桥接服务，OpenAI 兼容风格）。
- 未授权状态返回 HTTP 401，属预期鉴权行为，不是故障。

## 配置来源（优先级从高到低）

`DshAIClient`（src/host/services/ai-client.ts）按以下顺序解析：

1. 构造参数 `config.baseURL / config.model / config.apiKey`；
2. 环境变量 `WORKBUDDY_BRIDGE_URL`、`WORKBUDDY_BRIDGE_MODEL`、`WORKBUDDY_BRIDGE_API_KEY`；
3. 凭据文件 `%USERPROFILE%\.dsh\.credentials.yaml` 中的 `WORKBUDDY_BRIDGE_API_KEY:` 键。

## 测试门禁

- 真实模型集成测试：`tests/host_ai_integration.test.mjs`，仅在环境变量 `TEST_REAL_LLM=true` 时运行；门禁开启但端点不可用/未授权时**断言失败**，不静默跳过为通过。
- 常规回归（`npm test`）默认不消耗模型调用。

## 边界披露（与 01-PRODUCT 一致）

- 该桥接只提供文本生成能力（`getBackendInfo().capabilities.hostAgentSandbox = false`），不证明项目文件工具执行、DSH 审批管线或持续 Agent 生命周期已具备。
- 凭据文件属于私有材料，不入 Git、不出现在任何记录或报告中。
- 若桥接端点缺失，主助理按降级路径回复并如实显示能力缺口，不伪造模型输出。
