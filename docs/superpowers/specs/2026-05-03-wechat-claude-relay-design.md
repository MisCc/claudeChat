# WeChat-Claude LAN Relay 设计文档

## 概述

手机微信扫码连接电脑，通过局域网实时与 Claude CLI 双向聊天。后端纯转发，不存储任何数据。

## 约束

- 手机和电脑必须在同一 WiFi 局域网
- 禁止公网访问、不做端口映射、不用云服务器
- 后端不落地、不存储、无数据库、不写文件、不存日志
- 手机端通过微信内置浏览器访问 H5 页面
- 先支持单人使用，架构预留多人扩展空间

## 架构

```
┌──────────┐    WiFi LAN     ┌──────────────────┐    stdin/stdout  ┌─────────────┐
│  手机     │◄──WebSocket───►│  Node.js 后端     │◄───────────────►│ claude CLI  │
│  (H5页面) │                │  Express + ws     │   (持久进程)     │ (交互模式)  │
└──────────┘                 └──────────────────┘                 └─────────────┘
                                  │
                                  ▼
                            终端显示 QR 码
```

## 技术栈

- **后端**: Node.js + Express + ws
- **前端**: 纯 HTML/CSS/JS（ES5 兼容微信内置浏览器）
- **依赖**: express, ws, qrcode（仅 3 个）
- **Claude 交互**: 交互模式 `claude --output-format stream-json`（stdin/stdout 双向通信）

## 通信协议

### WebSocket 消息格式（JSON）

**手机 → 后端:**
```json
{"type": "chat", "content": "用户消息"}
{"type": "tool_response", "id": "toolu_xxx", "approved": true}
{"type": "select_option", "content": "1"}
```

**后端 → 手机（流式）:**
```json
{"type": "stream", "content": "逐token推送"}
{"type": "done", "content": "完整回复文本"}
{"type": "error", "content": "错误信息"}
```

**后端 → 手机（状态）:**
```json
{"type": "status", "content": "connecting"}
{"type": "status", "content": "thinking"}
{"type": "status", "content": "ready"}
```

**后端 → 手机（工具审批）:**
```json
{
  "type": "tool_request",
  "requests": [
    { "id": "toolu_1", "tool": "Bash", "input": "ls -la" },
    { "id": "toolu_2", "tool": "Read", "input": "foo.txt" }
  ]
}
```

**后端 → 手机（通知）:**
```json
{"type": "notify", "content": "new_message"}
```

## 会话管理

- 首次消息：通过 stdin 发送，从返回 JSON 中提取 session_id
- 后续消息：通过 stdin 发送，Claude 自动保持会话上下文
- session-id 仅存内存，进程退出即清空
- 断线重连后重新 spawn Claude 子进程，通过 `--resume` 恢复会话

## Claude 子进程管理

### 生命周期

```
WebSocket 连接 → spawn Claude 子进程（交互模式）
     ↓
保持 stdin 打开，持续读取 stdout stream-json
     ↓
收到用户消息 → 写入 stdin
     ↓
解析 stdout → 分发到手机
     ↓
WebSocket 断开 → kill Claude 子进程
     ↓
重连 → 重新 spawn + --resume
```

### 启动参数

```
spawn('claude', ['--output-format', 'stream-json', '--verbose'], {
  shell: true,
  cwd: startDir  // 可选，来自 --dir 参数
})
```

## 消息队列

- Claude 回复完成前，手机端禁用发送按钮
- 工具审批期间，手机端禁用发送按钮，显示审批弹窗
- 回复完成后恢复可发送状态
- 避免并发调用导致冲突

## 前端 H5 页面

```
┌─────────────────────────┐
│  Claude Chat            │  顶部标题栏
├─────────────────────────┤
│                         │
│  用户消息（右侧气泡）     │
│                         │
│  AI 回复（左侧气泡）     │  逐字流式渲染
│    [1. 选项A]           │  可点击选项按钮
│    [2. 选项B]           │
│                         │
├─────────────────────────┤
│  ┌─ Tool Approval ────┐ │  工具审批弹窗
│  │ Bash: ls -la       │ │
│  │ [Approve] [Reject] │ │
│  └────────────────────┘ │
├─────────────────────────┤
│ [输入消息...]     [发送] │  底部固定输入栏
└─────────────────────────┘
```

**关键设计:**
- 适配微信内置浏览器（ES5 兼容）
- 输入框固定底部，软键盘弹出不遮挡消息
- 流式回复逐字渲染，自动滚动到底部
- 连接状态指示（连接中/已连接/断开重连）
- 自动重连（指数退避，最多 30s 间隔）

## 新功能：通知提示音

当 AI 回复完成时，在手机端播放简短提示音。

**实现方式：**
- 使用 Web Audio API（`AudioContext`），无需外部音频文件
- 播放简短"叮"声（正弦波 + 快速衰减，约 200ms）
- 仅在 `handleDone`（回复完成）时触发
- 处理微信浏览器自动播放限制：首次用户交互后解锁 `AudioContext`
- 收到 `notify` 消息类型时触发播放

## 新功能：启动目录参数

启动时可选指定 Claude 工作目录，指定后跳过会话选择。

**用法：**
```bash
# 指定目录，跳过会话选择，新建会话
node server.js --dir /path/to/project

# 无参数：保留现有会话选择流程
node server.js
```

**实现：**
- 启动时解析 `process.argv` 中的 `--dir` 参数
- 如果 `--dir` 存在且路径有效：
  - 跳过 `selectSession()`，直接新建会话
  - 将 `cwd` 传给 spawn：`spawn('claude', args, { shell: true, cwd: dir })`
  - 终端提示 "Starting in directory: /path/to/project"
- 如果 `--dir` 不存在：走现有会话选择流程
- 如果 `--dir` 路径无效：报错退出

## 新功能：工具调用审批

Claude 尝试使用工具（Bash、Read、Write 等）时，手机端弹出审批弹窗，用户可批准或拒绝。

### 审批流程

```
Claude 输出 tool_use 事件
     ↓
服务端提取工具名、参数
     ↓
发送 tool_request 到手机
     ↓
手机显示审批弹窗（支持多工具同时审批）
     ↓
用户点击批准/拒绝
     ↓
服务端将 tool_result 注入 Claude stdin
     ↓
Claude 继续执行
```

### 多工具同时审批

同一个 assistant 消息中的多个 tool_use 打包成一个审批请求：

```json
{
  "type": "tool_request",
  "requests": [
    { "id": "toolu_1", "tool": "Bash", "input": "ls -la" },
    { "id": "toolu_2", "tool": "Read", "input": "foo.txt" }
  ]
}
```

手机端显示：
- 每个工具可单独批准/拒绝
- "全部批准" / "全部拒绝" 快捷按钮
- 所有结果打包返回后一次性注入 Claude stdin

### 审批 UI

```
┌─────────────────────────────┐
│  Tool Approval (2)          │
├─────────────────────────────┤
│  Bash: ls -la       [✓] [✗]│
│  Read: foo.txt      [✓] [✗]│
│                             │
│  [Approve All] [Reject All] │
└─────────────────────────────┘
```

### 关键技术点

- **stdin 写入**：消息和 tool_result 都通过 `proc.stdin.write()` 注入，以换行符分隔
- **stream 解析**：沿用 `readline` 逐行解析 stdout 的方式
- **进程生命周期**：WebSocket 断开时 kill Claude 子进程；重连时重新 spawn
- **错误恢复**：子进程异常退出时通知手机，重连后重新 spawn
- **降级方案**：如果交互模式 stdin 注入 tool_result 不可行，退回到 `--allowedTools` 预批准方案

## 新功能：选项按钮交互

当 Claude 输出包含多个选项时（如方案选择），手机端自动识别并渲染为可点击按钮。

### 检测逻辑

匹配模式：以数字+点开头的连续多行（`1. xxx\n2. xxx`），或以 `-` 开头的列表项。

### 交互流程

```
Claude 输出: "有两个方案：\n1. 用 Redis 缓存\n2. 用本地内存缓存"
     ↓
手机渲染:
  ┌────────────────────────┐
  │ 有两个方案：            │
  │ [1. 用 Redis 缓存]     │  ← 可点击按钮
  │ [2. 用本地内存缓存]     │  ← 可点击按钮
  └────────────────────────┘
     ↓
用户点击 → 发送选项内容给 Claude → Claude 继续
```

### 约束

- 选项按钮仅在 AI 回复的**最后一条消息**中激活
- 点击后按钮变灰，防止重复提交
- 如果 Claude 输出不含可识别选项，照常显示纯文本

## QR 码

- 后端启动时获取局域网 IP
- 终端打印 ASCII QR 码（内容为 `http://<LAN-IP>:<PORT>`）
- 电脑浏览器也可访问同一地址（方便调试）

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| WebSocket 断开 | 自动重连，指数退避，UI 提示；kill Claude 子进程 |
| Claude CLI 未安装 | 启动时检测，给出明确提示 |
| Claude 子进程崩溃 | 通知手机，重连后重新 spawn |
| CLI 输出异常 | 解析失败返回 error 消息 |
| 网络中断 | 重连后 resume session 恢复 |
| 工具审批超时 | 5 分钟超时，自动拒绝，通知手机 |
| --dir 路径无效 | 启动时报错退出 |

## 隐私保障

- 无数据库、无文件存储、无日志文件
- 内存中仅保留当前活跃连接的 session-id
- 进程退出后一切清空
- 绑定 0.0.0.0 以便局域网访问，但不做端口映射/公网暴露

## 项目结构

```
agentapp/
├── package.json
├── server.js          # 主服务
├── public/
│   ├── index.html     # H5 聊天页面
│   ├── style.css      # 样式
│   └── app.js         # 前端逻辑
└── README.md
```

## 启动流程

1. `npm install`
2. `node server.js [--dir /path/to/project]`
3. 终端显示局域网 IP + QR 码
4. 手机微信扫码连接
