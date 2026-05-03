# WeChat-Claude LAN Relay 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LAN-only relay that lets a phone (via WeChat QR scan) chat with Claude CLI on a PC in real-time.

**Architecture:** Node.js Express server serves an H5 page, uses WebSocket for real-time bidirectional messaging, spawns `claude -p --output-format stream-json` for each message, streams responses back to the phone.

**Tech Stack:** Node.js, Express, ws, qrcode, vanilla HTML/CSS/JS (ES5 compatible)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | Project config, dependencies (express, ws, qrcode) |
| `server.js` | Express HTTP server, WebSocket server, Claude CLI spawning, QR code display |
| `public/index.html` | H5 chat page structure (WeChat-compatible) |
| `public/style.css` | Mobile-first chat UI styles |
| `public/app.js` | WebSocket client, chat logic, auto-reconnect, streaming render |

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "wechat-claude-relay",
  "version": "1.0.0",
  "private": true,
  "description": "LAN relay for WeChat to Claude CLI",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "qrcode": "^1.5.4"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd d:/workspace/agentapp && npm install`
Expected: node_modules created, no errors

- [ ] **Step 3: Create public directory**

Run: `mkdir -p d:/workspace/agentapp/public`
Expected: public/ directory exists

- [ ] **Step 4: Commit**

```bash
git init
git add package.json package-lock.json
git commit -m "chore: project setup with express, ws, qrcode"
```

---

### Task 2: Express Static Server + LAN IP Detection

**Files:**
- Create: `server.js`

- [ ] **Step 1: Write server.js with Express and LAN IP detection**

```javascript
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = process.env.PORT || 3000;
const lanIp = getLanIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Server running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  LAN:     http://${lanIp}:${PORT}`);
  console.log(`\n  Waiting for QR code and WebSocket...\n`);
});
```

- [ ] **Step 2: Verify server starts**

Run: `cd d:/workspace/agentapp && timeout 5 node server.js || true`
Expected: Shows "Server running at" with LAN IP, then exits after timeout

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: express static server with LAN IP detection"
```

---

### Task 3: WebSocket Server

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add WebSocket server to server.js**

Add after the `server.listen` block:

```javascript
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

let currentSessionId = null;
let isProcessing = false;

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.send(JSON.stringify({ type: 'status', content: 'ready' }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
      return;
    }

    if (msg.type === 'chat' && msg.content) {
      if (isProcessing) {
        ws.send(JSON.stringify({ type: 'error', content: 'AI is still processing, please wait' }));
        return;
      }
      // Placeholder - will call Claude CLI in next task
      ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));
      ws.send(JSON.stringify({ type: 'stream', content: 'Echo: ' + msg.content }));
      ws.send(JSON.stringify({ type: 'done', content: 'Echo: ' + msg.content }));
      ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});
```

- [ ] **Step 2: Verify WebSocket works**

Run: `cd d:/workspace/agentapp && node server.js &`
Then in another terminal:
```bash
# Install wscat if not available
npx wscat -c ws://localhost:3000 -x '{"type":"chat","content":"hello"}'
```
Expected: Receives status "ready", then echo messages. Kill the server after.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: WebSocket server with message handling"
```

---

### Task 4: Claude CLI Integration

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add Claude CLI spawn function**

Replace the echo placeholder in the WebSocket message handler. Add this function before the WebSocket setup:

```javascript
const { spawn } = require('child_process');
const readline = require('readline');

function callClaude(ws, content) {
  isProcessing = true;
  ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));

  const args = ['-p', content, '--output-format', 'stream-json'];
  if (currentSessionId) {
    args.push('--resume', currentSessionId);
  }

  const proc = spawn('claude', args, { shell: true });
  let fullResponse = '';
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
    ws.send(JSON.stringify({ type: 'error', content: 'Claude timed out after 5 minutes' }));
    ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    isProcessing = false;
  }, 5 * 60 * 1000);

  const rl = readline.createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    if (timedOut) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && event.message && event.message.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            fullResponse += block.text;
            ws.send(JSON.stringify({ type: 'stream', content: block.text }));
          }
        }
      }
      if (event.type === 'result') {
        if (event.session_id) {
          currentSessionId = event.session_id;
        }
      }
    } catch (e) {
      // Non-JSON line, ignore
    }
  });

  proc.stderr.on('data', (data) => {
    console.error('Claude stderr:', data.toString());
  });

  proc.on('close', (code) => {
    clearTimeout(timeout);
    if (!timedOut) {
      ws.send(JSON.stringify({ type: 'done', content: fullResponse }));
      ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    }
    isProcessing = false;
  });

  proc.on('error', (err) => {
    clearTimeout(timeout);
    ws.send(JSON.stringify({ type: 'error', content: 'Failed to start Claude CLI: ' + err.message }));
    ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    isProcessing = false;
  });
}
```

- [ ] **Step 2: Replace echo placeholder with callClaude**

In the WebSocket message handler, replace:
```javascript
      // Placeholder - will call Claude CLI in next task
      ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));
      ws.send(JSON.stringify({ type: 'stream', content: 'Echo: ' + msg.content }));
      ws.send(JSON.stringify({ type: 'done', content: 'Echo: ' + msg.content }));
      ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
```

With:
```javascript
      callClaude(ws, msg.content);
```

- [ ] **Step 3: Add CLI check at startup**

Add after the WebSocket setup, before `server.listen`:

```javascript
function checkClaudeCli() {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], { shell: true });
    let output = '';
    proc.stdout.on('data', (d) => { output += d; });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('  Claude CLI detected: ' + output.trim());
        resolve(true);
      } else {
        console.error('\n  WARNING: Claude CLI not found or returned error.');
        console.error('  Please install Claude CLI first.\n');
        resolve(false);
      }
    });
    proc.on('error', () => {
      console.error('\n  WARNING: Claude CLI not found.');
      console.error('  Please install Claude CLI first.\n');
      resolve(false);
    });
  });
}
```

Call it before starting the server - wrap the `server.listen` in an async IIFE:

```javascript
(async () => {
  await checkClaudeCli();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Server running at:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  LAN:     http://${lanIp}:${PORT}`);
    console.log('');
  });
})();
```

- [ ] **Step 4: Verify Claude integration**

Run: `cd d:/workspace/agentapp && node server.js &`
Connect with wscat and send a chat message. Expected: streams Claude's response back.
Kill server after.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: Claude CLI integration with streaming and session resume"
```

---

### Task 5: QR Code Display

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add QR code generation**

Add at the top of server.js (after requires):

```javascript
const QRCode = require('qrcode');
```

Add inside the `server.listen` callback, after the console.log lines:

```javascript
    const url = `http://${lanIp}:${PORT}`;
    QRCode.toString(url, { type: 'terminal', small: true }, (err, qr) => {
      if (err) {
        console.log('  QR Code generation failed:', err.message);
      } else {
        console.log('  Scan with WeChat to connect:\n');
        console.log(qr);
      }
    });
```

- [ ] **Step 2: Verify QR code displays**

Run: `cd d:/workspace/agentapp && node server.js &`
Expected: Terminal shows LAN IP and a QR code. Kill after verifying.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: QR code display on startup"
```

---

### Task 6: H5 Page Structure

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Claude Chat</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header id="header">
      <span class="title">Claude Chat</span>
      <span id="status" class="status">Connecting...</span>
    </header>
    <div id="messages"></div>
    <footer id="input-bar">
      <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off">
      <button id="send-btn">Send</button>
    </footer>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: H5 chat page structure"
```

---

### Task 7: Chat UI Styles

**Files:**
- Create: `public/style.css`

- [ ] **Step 1: Create style.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  background: #f5f5f5;
  overflow: hidden;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 600px;
  margin: 0 auto;
  background: #fff;
}

#header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #07c160;
  color: #fff;
  flex-shrink: 0;
}

#header .title {
  font-size: 18px;
  font-weight: 600;
}

#header .status {
  font-size: 12px;
  opacity: 0.8;
}

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
}

.msg {
  margin-bottom: 16px;
  display: flex;
}

.msg.user {
  justify-content: flex-end;
}

.msg.ai {
  justify-content: flex-start;
}

.msg .bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  word-wrap: break-word;
  line-height: 1.5;
  font-size: 15px;
  white-space: pre-wrap;
}

.msg.user .bubble {
  background: #07c160;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.msg.ai .bubble {
  background: #f0f0f0;
  color: #333;
  border-bottom-left-radius: 4px;
}

.msg .bubble.error {
  background: #fee;
  color: #c00;
  border: 1px solid #fcc;
}

#input-bar {
  display: flex;
  padding: 10px 12px;
  border-top: 1px solid #e5e5e5;
  background: #fafafa;
  flex-shrink: 0;
}

#msg-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 15px;
  outline: none;
  background: #fff;
}

#msg-input:focus {
  border-color: #07c160;
}

#send-btn {
  margin-left: 8px;
  padding: 8px 20px;
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 15px;
  cursor: pointer;
  flex-shrink: 0;
}

#send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

#send-btn:active:not(:disabled) {
  background: #06ad56;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: mobile-first chat UI styles"
```

---

### Task 8: Frontend WebSocket Client + Chat Logic

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Create app.js**

```javascript
(function() {
  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('msg-input');
  var sendBtn = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');

  var ws = null;
  var reconnectDelay = 1000;
  var maxReconnectDelay = 30000;
  var currentAiBubble = null;
  var currentAiText = '';

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);

    ws.onopen = function() {
      reconnectDelay = 1000;
      setStatus('Connected', true);
    };

    ws.onmessage = function(event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'status':
          handleStatus(msg.content);
          break;
        case 'stream':
          handleStream(msg.content);
          break;
        case 'done':
          handleDone(msg.content);
          break;
        case 'error':
          handleError(msg.content);
          break;
      }
    };

    ws.onclose = function() {
      setStatus('Disconnected', false);
      setEnabled(false);
      setTimeout(function() {
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = function() {
      ws.close();
    };
  }

  function handleStatus(status) {
    switch (status) {
      case 'ready':
        setStatus('Connected', true);
        setEnabled(true);
        currentAiBubble = null;
        currentAiText = '';
        break;
      case 'thinking':
        setStatus('AI thinking...', false);
        setEnabled(false);
        currentAiText = '';
        currentAiBubble = addMessage('', 'ai');
        break;
      case 'connecting':
        setStatus('Connecting...', false);
        setEnabled(false);
        break;
    }
  }

  function handleStream(text) {
    if (currentAiBubble) {
      currentAiText += text;
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.textContent = currentAiText;
      scrollToBottom();
    }
  }

  function handleDone(fullText) {
    if (currentAiBubble && fullText) {
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.textContent = fullText;
    }
    currentAiBubble = null;
    currentAiText = '';
    scrollToBottom();
  }

  function handleError(errMsg) {
    if (currentAiBubble) {
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.className = 'bubble error';
      bubbleEl.textContent = 'Error: ' + errMsg;
      currentAiBubble = null;
      currentAiText = '';
    } else {
      addMessage('Error: ' + errMsg, 'ai', true);
    }
    scrollToBottom();
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    addMessage(text, 'user');
    inputEl.value = '';
    setEnabled(false);

    ws.send(JSON.stringify({ type: 'chat', content: text }));
  }

  function addMessage(text, type, isError) {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'msg ' + type;

    var bubble = document.createElement('div');
    bubble.className = 'bubble' + (isError ? ' error' : '');
    bubble.textContent = text;

    msgDiv.appendChild(bubble);
    messagesEl.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(text, connected) {
    statusEl.textContent = text;
    statusEl.style.opacity = connected ? '1' : '0.7';
  }

  function setEnabled(enabled) {
    sendBtn.disabled = !enabled;
    inputEl.disabled = !enabled;
    if (enabled) {
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      sendMessage();
    }
  });

  setEnabled(false);
  connect();
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: WebSocket client with streaming chat and auto-reconnect"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Start the server**

Run: `cd d:/workspace/agentapp && node server.js`
Expected: Shows LAN IP, QR code, "Claude CLI detected"

- [ ] **Step 2: Open in browser**

Open `http://localhost:3000` in a browser. Expected: Chat UI loads, status shows "Connected"

- [ ] **Step 3: Send a test message**

Type "hello" and press Enter. Expected: Message appears as green bubble, AI streams response in gray bubble

- [ ] **Step 4: Verify streaming**

Send a longer prompt like "Write a short poem". Expected: Text appears word-by-word in the AI bubble

- [ ] **Step 5: Verify session continuity**

Send "What did I just ask?". Expected: Claude remembers the previous conversation

- [ ] **Step 6: Verify queue behavior**

While Claude is responding, verify the send button is disabled and shows "AI thinking..."

- [ ] **Step 7: Test QR code**

Scan the terminal QR code with phone WeChat. Expected: Opens the chat page in WeChat browser

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete WeChat-Claude LAN relay"
```
