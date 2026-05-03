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
┌──────────┐    WiFi LAN     ┌──────────────────┐    CLI    ┌─────────────┐
│  手机     │◄──WebSocket───►│  Node.js 后端     │◄────────►│ claude CLI  │
│  (H5页面) │                │  Express + ws     │  spawn   │ (stream-json)│
└──────────┘                 └──────────────────┘          └─────────────┘
                                  │
                                  ▼
                            终端显示 QR 码
```

## 技术栈

- **后端**: Node.js + Express + ws
- **前端**: 纯 HTML/CSS/JS（ES5 兼容微信内置浏览器）
- **依赖**: express, ws, qrcode（仅 3 个）
- **Claude 交互**: `claude -p --output-format stream-json --resume <session-id>`

## 通信协议

### WebSocket 消息格式（JSON）

**手机 → 后端:**
```json
{"type": "chat", "content": "用户消息"}
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

## 会话管理

- 首次消息：`claude -p "消息" --output-format stream-json`（无 --resume），从返回 JSON 中提取 session_id
- 后续消息：`claude -p "消息" --output-format stream-json --resume <session-id>`
- session-id 仅存内存，进程退出即清空
- 断线重连后通过 `--resume` 恢复会话（手机端需在重连时告知后端恢复哪个 session）

## 消息队列

- Claude 回复完成前，手机端禁用发送按钮
- UI 显示"AI 正在回复中..."状态
- 回复完成后恢复可发送状态
- 避免并发调用同一 session 导致冲突

## 前端 H5 页面

```
┌─────────────────────────┐
│  Claude Chat            │  顶部标题栏
├─────────────────────────┤
│                         │
│  用户消息（右侧气泡）     │
│                         │
│  AI 回复（左侧气泡）     │  逐字流式渲染
│                         │
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

## QR 码

- 后端启动时获取局域网 IP
- 终端打印 ASCII QR 码（内容为 `http://<LAN-IP>:<PORT>`）
- 电脑浏览器也可访问同一地址（方便调试）

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| WebSocket 断开 | 自动重连，指数退避，UI 提示 |
| Claude CLI 未安装 | 启动时检测，给出明确提示 |
| CLI 执行超时 | 5 分钟超时，kill 进程，通知手机 |
| CLI 输出异常 | 解析失败返回 error 消息 |
| 网络中断 | 重连后 resume session 恢复 |

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
2. `node server.js`
3. 终端显示局域网 IP + QR 码
4. 手机微信扫码连接
