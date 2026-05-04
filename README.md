## 概述

手机微信扫码连接电脑，通过局域网实时与 Claude CLI 双向聊天。后端纯转发，不存储任何数据。

## 约束

- 手机和电脑必须在同一 WiFi 局域网
- 禁止公网访问、不做端口映射、不用云服务器
- 后端不落地、不存储、无数据库、不写文件、不存日志
- 手机端通过微信内置浏览器访问 H5 页面
- 先支持单人使用，架构预留多人扩展空间

## 环境要求

- **Node.js** — v18 或更高版本
- **Claude CLI** — 需提前安装并登录（`npm install -g @anthropic-ai/claude-code`）
- **手机和电脑连接同一个 WiFi**

## 安装

```bash
# 1. 进入项目目录
cd d:\workspace\agentapp

# 2. 安装依赖
npm install

# 3. 确认 Claude CLI 可用
claude --version
```

## 使用方式

### 方式一：双击图标（推荐）

首次使用需要创建桌面快捷方式：

```bash
# 双击运行，自动生成图标并在桌面创建 "Claude Chat" 快捷方式
create-shortcut.bat
```

之后每次使用：

1. **双击桌面 "Claude Chat" 图标**
2. 控制台弹出，提示输入工作目录：
   ```
   Enter working directory for Claude (leave empty to select session):
   Directory:
   ```
3. **输入一个目录路径**（如 `D:\myproject`）— Claude 会在该目录下工作
4. **直接回车（留空）** — 进入会话选择，可选历史会话或新建
5. 服务器启动后**自动弹出二维码图片**，用微信扫一扫连接手机

### 方式二：命令行启动

```bash
cd d:\workspace\agentapp
node server.js
```

启动后控制台会提示选择会话或指定工作目录。

### 方式三：指定工作目录启动

跳过交互提示，直接指定 Claude 工作目录：

```bash
node server.js --dir D:\myproject
```

### 手机连接

1. 确保手机和电脑在同一 WiFi
2. 微信扫描二维码（或在手机浏览器输入控制台显示的 LAN 地址）
3. 打开后进入聊天界面，状态显示 "Connected" 即连接成功
4. 直接输入消息即可与 Claude 对话

## 功能特性

- **实时流式输出** — Claude 回复逐字显示，无需等待完整响应
- **会话恢复** — 支持选择历史会话继续之前的对话
- **Markdown 渲染** — 支持加粗、斜体、代码块等格式
- **选项按钮** — Claude 给出编号选项时，可直接点击选择
- **工具调用展示** — 显示 Claude 正在执行的工具操作（读写文件、运行命令等）
- **消息通知** — Claude 回复完成时发出提示音
- **断线重连** — 手机端网络中断后自动重连

## 文件说明

| 文件 | 说明 |
|------|------|
| `server.js` | 后端服务，转发消息到 Claude CLI |
| `public/index.html` | 手机端 H5 页面 |
| `public/app.js` | 手机端交互逻辑 |
| `public/style.css` | 手机端样式 |
| `start.vbs` | 双击启动脚本（静默启动 Node 服务） |
| `start.bat` | 命令行启动脚本（带控制台输出） |
| `create-shortcut.bat` | 生成桌面快捷方式 |

## 常见问题

**手机扫不了二维码？**
- 确认手机和电脑在同一 WiFi
- 确认电脑防火墙未阻止 3001 端口
- 直接在手机浏览器输入 LAN 地址（如 `http://192.168.x.x:3001`）试试

**双击图标没反应？**
- 确认 Node.js 已安装且在系统 PATH 中，或使用 `start.bat` 启动查看报错

**Claude CLI 报错？**
- 运行 `claude --version` 确认已安装
- 运行 `claude` 确认已登录认证
