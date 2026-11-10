---
status: accepted
---

# 独立科研 Agent 服务前期采用 Pi SDK

2026-11-09 用户提出前期接入 Pi SDK，作为 ADR-0009 中独立科研 Agent 服务的内部执行引擎。初期复用 Pi 的会话、工具调用、模型接入和流式事件能力，通过 MCP 对接现有 DBHub；平台的任务、数据来源、分析执行环境和科研交付物仍需明确自己的职责及契约。

这一选择优先复用已有 Agent 引擎，减少从零维护通用运行循环的工作；代价是需要适配 Pi 的会话、事件和扩展接口。科研任务的完成标准不能直接等同于模型一次回复结束或 SDK 会话结束。首期使用范围已确定为个人使用，允许 Agent 在独立分析环境中编写、运行和修改 Python 代码，并保存分析代码、输入来源及结果。

本机当前 Pi 安装版本为 `1.2.0`，包名 `@earendil-works/pi-coding-agent`；官方 SDK 运行于 Node.js/Bun。SDK 会话需要显式装载 MCP 扩展并完成绑定，不能假定装好 CLI 后新服务会自动连接 DBHub。来源：[SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[MCP 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)，以及本机安装包随附文档及 `examples/sdk/14-codemode-mcp.ts`。

后续确认：首期 Agent 服务及 Python 分析环境均在当前 Linux 本机运行，连接已有本地 DBHub；界面采用科研任务工作区，持久化及恢复目标见 [ADR-0011](0011-durable-research-task-workspace.md)。

尚未决定：分析环境的具体隔离方案、服务 API、SDK 版本锁定、仓库布局及替换现有问答端点的步骤。本次没有安装依赖、启动 Pi 会话或修改运行服务。
