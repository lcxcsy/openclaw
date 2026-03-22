# WebSocketClient 插件规范

## Why

当前 OpenClaw 系统的 Control UI 仅能在 Web 浏览器环境中运行，无法在非 Web 节点（如服务器、CI/CD 环境、远程终端）上对智能体配置文件进行远程更新与管理。本规范旨在设计并实现一个独立的 WebSocketClient 插件组件，使其能够模拟 Control UI 的核心功能，提供配置文件的远程管理能力。

## What Changes

- 新增 `websocket-client` 插件包
- 实现 WebSocket 客户端组件，建立与 Gateway 的稳定连接
- 提供配置文件操作接口（AGENTS.md、SOUL.md 等）
- 实现配置版本控制与历史记录
- 实现原子性配置更新操作
- 实现断线重连与数据同步
- 实现权限验证与操作审计
- 提供 CLI 命令行工具和 API 接口

## Impact

- Affected specs: 智能体配置文件管理、Gateway 通信协议
- Affected code:
  - 新增 `extensions/websocket-client/` 目录
  - 新增 CLI 命令：`openclaw config sync`、`openclaw config update`
  - 新增 API 接口：配置读取、更新、版本查询

## ADDED Requirements

### Requirement: WebSocket 连接管理

系统 SHALL 提供稳定的 WebSocket 连接管理功能，支持与 Gateway 的双向实时通信。

#### Scenario: 正常连接
- **GIVEN** Gateway 服务运行中且可访问
- **WHEN** 客户端发起连接请求
- **THEN** 建立 WebSocket 连接并完成握手认证
- **AND** 接收 HelloOk 响应，包含可用方法和事件列表

#### Scenario: 连接断开
- **GIVEN** 已建立连接的客户端
- **WHEN** 网络中断或 Gateway 重启
- **THEN** 自动触发重连机制
- **AND** 使用指数退避策略（初始 1s，最大 30s）

#### Scenario: 认证失败
- **GIVEN** 客户端提供无效凭证
- **WHEN** 尝试连接 Gateway
- **THEN** 返回详细错误信息，包含错误码和建议

### Requirement: 配置文件读取

系统 SHALL 提供配置文件读取接口，支持 AGENTS.md、SOUL.md 等指定格式文件。

#### Scenario: 读取 AGENTS.md
- **WHEN** 用户执行 `openclaw config get agents`
- **THEN** 通过 WebSocket 请求获取 agents.list 和 agents.files.get 方法
- **AND** 返回当前 AGENTS.md 文件内容

#### Scenario: 读取 SOUL.md
- **WHEN** 用户执行 `openclaw config get soul`
- **THEN** 获取 soul 相关配置文件内容
- **AND** 返回配置内容或文件不存在提示

### Requirement: 配置文件更新

系统 SHALL 提供配置文件更新接口，支持指定格式文件的内容修改。

#### Scenario: 更新 AGENTS.md
- **WHEN** 用户执行 `openclaw config update agents --content "..."`
- **THEN** 通过 WebSocket 发送 agents.files.set 请求
- **AND** 返回更新结果和新的版本号

#### Scenario: 批量更新配置
- **WHEN** 用户同时更新多个配置文件
- **THEN** 按顺序执行更新操作
- **AND** 返回每个文件的更新状态

### Requirement: 版本控制与历史记录

系统 SHALL 实现配置变更的版本控制与历史记录功能。

#### Scenario: 版本查询
- **WHEN** 用户执行 `openclaw config history agents`
- **THEN** 返回配置文件的版本变更历史
- **AND** 包含每次变更的时间、操作类型、操作者

#### Scenario: 版本回滚
- **WHEN** 用户执行 `openclaw config rollback agents --version 5`
- **THEN** 将配置文件恢复到指定版本
- **AND** 创建新版本记录变更

### Requirement: 原子性操作

系统 SHALL 支持配置更新的原子性操作，确保文件修改的完整性。

#### Scenario: 事务性更新
- **WHEN** 用户执行带事务标记的配置更新
- **THEN** 如果任一文件更新失败
- **AND** 自动回滚所有已修改的文件

#### Scenario: 完整性校验
- **WHEN** 配置更新完成后
- **THEN** 验证文件内容完整性
- **AND** 校验失败时触发修复或警告

### Requirement: 状态反馈机制

系统 SHALL 提供配置更新状态反馈机制。

#### Scenario: 成功确认
- **WHEN** 配置更新成功
- **THEN** 返回成功状态和新的版本号
- **AND** 记录操作日志

#### Scenario: 失败重试
- **WHEN** 配置更新失败（网络错误）
- **THEN** 自动重试（最多 3 次）
- **AND** 每次重试增加退避延迟

#### Scenario: 错误提示
- **WHEN** 配置更新失败（业务错误）
- **THEN** 返回详细错误信息
- **AND** 包含错误码和恢复建议

### Requirement: 断线重连与数据同步

系统 SHALL 实现断线重连和数据同步机制。

#### Scenario: 自动重连
- **WHEN** 连接断开
- **THEN** 自动尝试重新连接
- **AND** 重连成功后会话状态恢复

#### Scenario: 配置差异同步
- **WHEN** 重连后检测到配置版本差异
- **THEN** 提示用户选择同步策略
- **AND** 支持本地优先、远程优先或手动合并

### Requirement: 权限验证与审计

系统 SHALL 实现权限验证与操作审计功能。

#### Scenario: 连接权限验证
- **WHEN** 客户端尝试连接
- **THEN** 验证凭证有效性
- **AND** 检查操作权限范围

#### Scenario: 操作审计日志
- **WHEN** 任何配置变更操作执行
- **THEN** 记录完整审计日志
- **AND** 包含时间戳、操作者、操作内容、结果

### Requirement: API 接口

系统 SHALL 提供清晰的 API 接口，便于集成调用。

#### Scenario: 编程式调用
- **WHEN** 其他程序导入并调用 SDK
- **THEN** 提供简洁的 Promise/async 接口
- **AND** 支持事件监听和回调

#### Scenario: CLI 使用
- **WHEN** 用户通过命令行使用
- **THEN** 提供友好的命令行界面
- **AND** 支持配置式参数和交互式输入

## MODIFIED Requirements

无

## REMOVED Requirements

无
