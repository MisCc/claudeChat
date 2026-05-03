# WeChat-Claude LAN Relay v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add notification sound, startup directory parameter, interactive tool approval, and option button interaction to the WeChat-Claude relay.

**Architecture:** Refactor server.js from per-message Claude spawning (`-p` mode) to a persistent interactive Claude process with stdin/stdout communication. Add WebSocket protocol messages for tool approval and option selection. Add Web Audio notification and CLI argument parsing.

**Tech Stack:** Node.js, Express, ws, Web Audio API, ES5-compatible frontend

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server.js` | Main server: Express, WebSocket, Claude process management, --dir parsing, tool approval flow |
| `public/app.js` | Frontend: WebSocket client, streaming chat, notification sound, tool approval UI, option buttons |
| `public/index.html` | HTML structure: add tool approval modal markup |
| `public/style.css` | Styles: add modal overlay, option button, approval item styles |

---

### Task 1: Notification Sound

Add a short beep sound when AI replies complete, using Web Audio API.

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add AudioContext and beep function**

Add at the top of the IIFE in `public/app.js`, after the variable declarations:

```javascript
var audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playBeep() {
  if (!audioCtx) return;
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  gain.gain.value = 0.3;
  osc.start(audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
  osc.stop(audioCtx.currentTime + 0.2);
}
```

- [ ] **Step 2: Unlock AudioContext on first user interaction**

Add before the `sendBtn.addEventListener` lines:

```javascript
document.addEventListener('touchstart', initAudio, { once: true });
document.addEventListener('click', initAudio, { once: true });
```

- [ ] **Step 3: Trigger beep on AI reply complete**

In the `handleDone` function, add `playBeep()` at the end:

```javascript
function handleDone(fullText) {
  if (currentAiBubble && fullText) {
    var bubbleEl = currentAiBubble.querySelector('.bubble');
    bubbleEl.textContent = fullText;
  }
  currentAiBubble = null;
  currentAiText = '';
  scrollToBottom();
  playBeep();
}
```

- [ ] **Step 4: Manual test**

1. Run `node server.js`
2. Open browser to `http://localhost:3001`
3. Send a message to Claude
4. Verify: beep sound plays when reply finishes
5. Verify: no beep during streaming, only on completion

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add notification beep on AI reply completion"
```

---

### Task 2: Startup Directory Parameter

Add `--dir` CLI argument to specify Claude's working directory and skip session selection.

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Parse --dir argument**

In `server.js`, replace the startup IIFE at the bottom. Add `--dir` parsing before `checkClaudeCli()`:

```javascript
function parseStartDir() {
  var dirIdx = process.argv.indexOf('--dir');
  if (dirIdx !== -1 && process.argv[dirIdx + 1]) {
    var dir = process.argv[dirIdx + 1];
    var fs = require('fs');
    try {
      var stat = fs.statSync(dir);
      if (!stat.isDirectory()) {
        console.error('\n  ERROR: --dir path is not a directory: ' + dir + '\n');
        process.exit(1);
      }
      return dir;
    } catch (e) {
      console.error('\n  ERROR: --dir path does not exist: ' + dir + '\n');
      process.exit(1);
    }
  }
  return null;
}
```

- [ ] **Step 2: Use startDir in startup flow**

Replace the entire `(async () => { ... })()` block at the bottom of `server.js`:

```javascript
(async () => {
  await checkClaudeCli();

  var startDir = parseStartDir();
  if (startDir) {
    console.log('  Starting in directory: ' + startDir);
    console.log('  Session selection skipped (--dir provided).\n');
  } else {
    var selectedId = await selectSession();
    if (selectedId) {
      currentSessionId = selectedId;
      console.log('  Resuming session: ' + currentSessionId);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Server running at:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  LAN:     http://${lanIp}:${PORT}`);
    console.log('');

    var url = `http://${lanIp}:${PORT}`;
    QRCode.toString(url, { type: 'terminal', small: true }, (err, qr) => {
      if (err) {
        console.log('  QR Code generation failed:', err.message);
      } else {
        console.log('  Scan with WeChat to connect:\n');
        console.log(qr);
      }
    });
  });
})();
```

- [ ] **Step 3: Store startDir globally for use in spawn**

Add `var startDir = null;` near the top of `server.js` (after `let isProcessing = false;`), and update the IIFE to set it:

```javascript
// Near the top, after other global vars
var startDir = null;

// In the IIFE, after parseStartDir():
startDir = parseStartDir();
```

Then update the `callClaude` function to use `startDir` as cwd. Find the `spawn('claude', args, { shell: true })` line and change to:

```javascript
var spawnOpts = { shell: true };
if (startDir) {
  spawnOpts.cwd = startDir;
}
const proc = spawn('claude', args, spawnOpts);
```

- [ ] **Step 4: Manual test**

1. Test with valid dir: `node server.js --dir d:/workspace/agentapp`
   - Verify: "Starting in directory: ..." printed, no session selection prompt
2. Test without dir: `node server.js`
   - Verify: session selection prompt appears as before
3. Test with invalid dir: `node server.js --dir /nonexistent`
   - Verify: error message and exit

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add --dir startup parameter to specify Claude working directory"
```

---

### Task 3: Interactive Mode Refactor

Refactor `callClaude` from per-message spawning to persistent interactive Claude process with stdin/stdout communication.

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add Claude process manager functions**

Add these functions to `server.js` after the global variable declarations:

```javascript
function spawnClaudeProcess(ws) {
  var args = ['--output-format', 'stream-json', '--verbose'];
  if (currentSessionId) {
    args.push('--resume', currentSessionId);
  }

  var spawnOpts = { shell: true };
  if (startDir) {
    spawnOpts.cwd = startDir;
  }

  var proc = spawn('claude', args, spawnOpts);
  var rl = readline.createInterface({ input: proc.stdout });

  ws.send(JSON.stringify({ type: 'status', content: 'connecting' }));

  proc.stderr.on('data', (data) => {
    console.error('Claude stderr:', data.toString());
  });

  rl.on('line', (line) => {
    handleClaudeOutput(ws, line);
  });

  proc.on('close', (code) => {
    console.log('Claude process exited with code ' + code);
    ws.send(JSON.stringify({ type: 'status', content: 'disconnected' }));
    ws._claudeProc = null;
  });

  proc.on('error', (err) => {
    console.error('Claude process error:', err.message);
    ws.send(JSON.stringify({ type: 'error', content: 'Failed to start Claude: ' + err.message }));
    ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    ws._claudeProc = null;
  });

  return proc;
}
```

- [ ] **Step 2: Add stream output handler**

Add this function to `server.js`:

```javascript
function handleClaudeOutput(ws, line) {
  try {
    var event = JSON.parse(line);

    if (event.type === 'assistant' && event.message && event.message.content) {
      for (var i = 0; i < event.message.content.length; i++) {
        var block = event.message.content[i];

        if (block.type === 'text' && block.text) {
          fullResponse += block.text;
          ws.send(JSON.stringify({ type: 'stream', content: block.text }));
        }

        if (block.type === 'tool_use') {
          pendingToolCalls.push({
            id: block.id,
            tool: block.name,
            input: JSON.stringify(block.input)
          });
        }
      }
    }

    if (event.type === 'result') {
      if (event.session_id) {
        currentSessionId = event.session_id;
      }
      // Flush any remaining tool calls as approval request
      if (pendingToolCalls.length > 0) {
        ws.send(JSON.stringify({
          type: 'tool_request',
          requests: pendingToolCalls
        }));
        pendingApprovalCount = pendingToolCalls.length;
        pendingToolCalls = [];
      } else {
        ws.send(JSON.stringify({ type: 'done', content: fullResponse }));
        ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
        if (fullResponse) {
          messageHistory.push({ role: 'ai', content: fullResponse });
        }
      }
      isProcessing = false;
    }
  } catch (e) {
    // Non-JSON line, ignore
  }
}
```

- [ ] **Step 3: Add global state for pending tool calls**

Add near the other global variables in `server.js`:

```javascript
var pendingToolCalls = [];
var pendingApprovalCount = 0;
var fullResponse = '';
```

- [ ] **Step 4: Add function to inject tool results into stdin**

```javascript
function sendToolResults(ws, results) {
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var resultMsg = JSON.stringify({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.approved ? 'Approved by user' : 'Rejected by user'
    });
    ws._claudeProc.stdin.write(resultMsg + '\n');
  }
  pendingApprovalCount = 0;
  ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));
}
```

- [ ] **Step 5: Refactor WebSocket connection handler**

Replace the entire `wss.on('connection', ...)` block in `server.js`:

```javascript
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Spawn Claude process for this connection
  var proc = spawnClaudeProcess(ws);
  ws._claudeProc = proc;

  // Replay history
  if (messageHistory.length > 0) {
    ws.send(JSON.stringify({ type: 'history', messages: messageHistory }));
  }

  // Auto-request recap for resumed sessions
  if (currentSessionId && messageHistory.length === 0) {
    setTimeout(() => {
      sendToClaude(ws, '请用中文简要总结我们之前的对话内容', true);
    }, 500);
  }

  ws.on('message', (data) => {
    var msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
      return;
    }

    if (msg.type === 'chat' && msg.content) {
      if (isProcessing || pendingApprovalCount > 0) {
        ws.send(JSON.stringify({ type: 'error', content: 'AI is still processing, please wait' }));
        return;
      }
      sendToClaude(ws, msg.content);
    }

    if (msg.type === 'tool_response') {
      // Will be handled in Task 4
    }

    if (msg.type === 'select_option') {
      if (msg.content && ws._claudeProc) {
        sendToClaude(ws, msg.content);
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (ws._claudeProc) {
      ws._claudeProc.kill();
      ws._claudeProc = null;
    }
  });
});
```

- [ ] **Step 6: Add sendToClaude function**

```javascript
function sendToClaude(ws, content, hidden) {
  if (!ws._claudeProc) return;

  isProcessing = true;
  fullResponse = '';
  pendingToolCalls = [];

  if (!hidden) {
    ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));
  }

  ws._claudeProc.stdin.write(content + '\n');

  if (!hidden && content) {
    messageHistory.push({ role: 'user', content: content });
  }
}
```

- [ ] **Step 7: Remove old callClaude function**

Delete the entire `function callClaude(ws, content, hidden)` block (lines ~16-92 in current server.js).

- [ ] **Step 8: Manual test**

1. Run `node server.js`
2. Open browser to `http://localhost:3001`
3. Send a message to Claude
4. Verify: streaming response works
5. Verify: session persists across multiple messages
6. Verify: disconnect and reconnect works (check terminal for process lifecycle)
7. Verify: Claude process is killed on disconnect

- [ ] **Step 9: Commit**

```bash
git add server.js
git commit -m "refactor: switch to interactive Claude process with stdin/stdout"
```

---

### Task 4: Tool Approval - Server Side

Parse tool_use events from Claude stream and handle approval flow via WebSocket.

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add tool_use detection in handleClaudeOutput**

The `handleClaudeOutput` function (from Task 3) already collects `pendingToolCalls`. However, the current logic only sends them on `result` event. We need to send them as soon as a complete assistant message with tool_use is detected.

Update the `handleClaudeOutput` function. After the `event.type === 'assistant'` block, add logic to detect when tool_use blocks are present and send the approval request immediately (before waiting for `result`):

```javascript
function handleClaudeOutput(ws, line) {
  try {
    var event = JSON.parse(line);

    if (event.type === 'assistant' && event.message && event.message.content) {
      var hasToolUse = false;
      for (var i = 0; i < event.message.content.length; i++) {
        var block = event.message.content[i];

        if (block.type === 'text' && block.text) {
          fullResponse += block.text;
          ws.send(JSON.stringify({ type: 'stream', content: block.text }));
        }

        if (block.type === 'tool_use') {
          hasToolUse = true;
          pendingToolCalls.push({
            id: block.id,
            tool: block.name,
            input: JSON.stringify(block.input)
          });
        }
      }

      // If this message has tool_use, send approval request now
      if (hasToolUse && pendingToolCalls.length > 0) {
        ws.send(JSON.stringify({
          type: 'tool_request',
          requests: pendingToolCalls.slice()
        }));
        pendingApprovalCount = pendingToolCalls.length;
        pendingToolCalls = [];
      }
    }

    if (event.type === 'result') {
      if (event.session_id) {
        currentSessionId = event.session_id;
      }
      ws.send(JSON.stringify({ type: 'done', content: fullResponse }));
      ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
      if (fullResponse) {
        messageHistory.push({ role: 'ai', content: fullResponse });
      }
      isProcessing = false;
      fullResponse = '';
    }
  } catch (e) {
    // Non-JSON line, ignore
  }
}
```

- [ ] **Step 2: Add tool_response handler in WebSocket message handler**

In the `ws.on('message', ...)` handler, add the tool_response case:

```javascript
if (msg.type === 'tool_response' && pendingApprovalCount > 0) {
  // Collect individual responses until all are received
  if (!ws._toolResponses) ws._toolResponses = [];
  ws._toolResponses.push({
    id: msg.id,
    approved: msg.approved
  });

  if (ws._toolResponses.length >= pendingApprovalCount) {
    sendToolResults(ws, ws._toolResponses);
    ws._toolResponses = [];
  }
}
```

- [ ] **Step 3: Add tool approval timeout**

Add a timeout mechanism. In the `sendToClaude` function, after setting `isProcessing = true`, add:

```javascript
// Tool approval timeout: 5 minutes
if (ws._toolApprovalTimeout) clearTimeout(ws._toolApprovalTimeout);
ws._toolApprovalTimeout = setTimeout(function() {
  if (pendingApprovalCount > 0) {
    ws.send(JSON.stringify({ type: 'error', content: 'Tool approval timed out' }));
    ws.send(JSON.stringify({ type: 'status', content: 'ready' }));
    pendingApprovalCount = 0;
    isProcessing = false;
    if (ws._claudeProc) ws._claudeProc.kill();
    ws._claudeProc = null;
  }
}, 5 * 60 * 1000);
```

And clear it in the tool_response handler when all responses are received:

```javascript
if (ws._toolResponses.length >= pendingApprovalCount) {
  if (ws._toolApprovalTimeout) clearTimeout(ws._toolApprovalTimeout);
  sendToolResults(ws, ws._toolResponses);
  ws._toolResponses = [];
}
```

- [ ] **Step 4: Manual test**

1. Run `node server.js`
2. Open browser, send a message that triggers tool use (e.g., "list files in current directory")
3. Verify: tool_request message appears in WebSocket (check browser dev tools Network > WS)
4. Verify: tool is not executed until approval
5. Verify: after approval, Claude receives the result and continues
6. Verify: rejection also works (Claude gets "Rejected by user")

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add tool approval flow via WebSocket"
```

---

### Task 5: Tool Approval - Client Side

Add tool approval modal UI to the frontend.

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 1: Add tool approval modal HTML**

In `public/index.html`, add before the closing `</div>` of `#app`:

```html
<div id="tool-modal" class="modal hidden">
  <div class="modal-content">
    <div class="modal-header">Tool Approval (<span id="tool-count">0</span>)</div>
    <div id="tool-list"></div>
    <div class="modal-actions">
      <button id="approve-all" class="btn-approve">Approve All</button>
      <button id="reject-all" class="btn-reject">Reject All</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add tool approval modal styles**

Add to `public/style.css`:

```css
.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal.hidden {
  display: none;
}

.modal-content {
  background: #fff;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  overflow: hidden;
}

.modal-header {
  padding: 14px 16px;
  font-weight: 600;
  font-size: 16px;
  border-bottom: 1px solid #eee;
}

#tool-list {
  padding: 12px 16px;
  max-height: 300px;
  overflow-y: auto;
}

.tool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f5f5f5;
}

.tool-item:last-child {
  border-bottom: none;
}

.tool-info {
  flex: 1;
  min-width: 0;
}

.tool-name {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.tool-input {
  font-size: 12px;
  color: #888;
  word-break: break-all;
  margin-top: 2px;
}

.tool-buttons {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 8px;
}

.tool-buttons button {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-approve-item {
  background: #07c160;
  color: #fff;
}

.btn-reject-item {
  background: #e5e5e5;
  color: #666;
}

.modal-actions {
  display: flex;
  padding: 12px 16px;
  gap: 10px;
  border-top: 1px solid #eee;
}

.modal-actions button {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.btn-approve {
  background: #07c160;
  color: #fff;
}

.btn-reject {
  background: #e5e5e5;
  color: #666;
}
```

- [ ] **Step 3: Add tool approval logic to app.js**

Add to `public/app.js` inside the IIFE:

```javascript
var toolModal = document.getElementById('tool-modal');
var toolList = document.getElementById('tool-list');
var toolCount = document.getElementById('tool-count');
var approveAllBtn = document.getElementById('approve-all');
var rejectAllBtn = document.getElementById('reject-all');
var pendingToolRequests = [];

function handleToolRequest(requests) {
  pendingToolRequests = requests;
  toolCount.textContent = requests.length;
  toolList.innerHTML = '';

  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    var item = document.createElement('div');
    item.className = 'tool-item';
    item.setAttribute('data-id', r.id);

    var info = document.createElement('div');
    info.className = 'tool-info';

    var name = document.createElement('div');
    name.className = 'tool-name';
    name.textContent = r.tool;

    var input = document.createElement('div');
    input.className = 'tool-input';
    input.textContent = r.input;

    info.appendChild(name);
    info.appendChild(input);

    var buttons = document.createElement('div');
    buttons.className = 'tool-buttons';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn-approve-item';
    approveBtn.textContent = 'OK';
    approveBtn.onclick = (function(id) {
      return function() { respondTool(id, true); };
    })(r.id);

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject-item';
    rejectBtn.textContent = 'NO';
    rejectBtn.onclick = (function(id) {
      return function() { respondTool(id, false); };
    })(r.id);

    buttons.appendChild(approveBtn);
    buttons.appendChild(rejectBtn);

    item.appendChild(info);
    item.appendChild(buttons);
    toolList.appendChild(item);
  }

  toolModal.classList.remove('hidden');
  setEnabled(false);
}

function respondTool(id, approved) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'tool_response', id: id, approved: approved }));

  // Remove item from list
  var item = toolList.querySelector('[data-id="' + id + '"]');
  if (item) item.remove();

  // If no more items, close modal
  if (toolList.children.length === 0) {
    toolModal.classList.add('hidden');
    setEnabled(true);
  }
}

approveAllBtn.onclick = function() {
  for (var i = 0; i < pendingToolRequests.length; i++) {
    respondTool(pendingToolRequests[i].id, true);
  }
  pendingToolRequests = [];
};

rejectAllBtn.onclick = function() {
  for (var i = 0; i < pendingToolRequests.length; i++) {
    respondTool(pendingToolRequests[i].id, false);
  }
  pendingToolRequests = [];
};
```

- [ ] **Step 4: Add tool_request handler in ws.onmessage**

In the `ws.onmessage` switch statement, add a case for `tool_request`:

```javascript
case 'tool_request':
  handleToolRequest(msg.requests);
  break;
```

- [ ] **Step 5: Manual test**

1. Run `node server.js`
2. Open browser, send a message that triggers tool use
3. Verify: modal appears with tool name and input
4. Verify: clicking OK sends tool_response with approved=true
5. Verify: clicking NO sends tool_response with approved=false
6. Verify: "Approve All" and "Reject All" work
7. Verify: modal closes after all tools are responded to
8. Verify: input is re-enabled after modal closes

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add tool approval modal UI"
```

---

### Task 6: Option Buttons

Detect numbered/ bulleted option lists in AI output and render as clickable buttons.

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 1: Add option detection function**

Add to `public/app.js`:

```javascript
function detectOptions(text) {
  var lines = text.split('\n');
  var optionLines = [];
  var prefixLines = [];
  var foundOptions = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var match = line.match(/^(\d+)\.\s+(.+)/);
    if (match) {
      foundOptions = true;
      optionLines.push({ num: match[1], text: match[2], full: line });
    } else if (foundOptions) {
      // Non-option line after options started — stop
      break;
    } else {
      prefixLines.push(line);
    }
  }

  if (optionLines.length < 2) return null;
  return { prefix: prefixLines.join('\n'), options: optionLines };
}
```

- [ ] **Step 2: Add option button rendering function**

```javascript
function renderOptions(result, prefix) {
  var container = document.createElement('div');
  container.className = 'msg ai';

  if (prefix && prefix.trim()) {
    var prefixBubble = document.createElement('div');
    prefixBubble.className = 'bubble';
    prefixBubble.textContent = prefix;
    container.appendChild(prefixBubble);
  }

  var optionGroup = document.createElement('div');
  optionGroup.className = 'option-group';

  for (var i = 0; i < result.options.length; i++) {
    var opt = result.options[i];
    var btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt.full;
    btn.setAttribute('data-option', opt.num);
    btn.onclick = (function(num) {
      return function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'select_option', content: num }));
          // Disable all option buttons
          var allBtns = optionGroup.querySelectorAll('.option-btn');
          for (var j = 0; j < allBtns.length; j++) {
            allBtns[j].disabled = true;
            allBtns[j].className = 'option-btn disabled';
          }
          addMessage(num, 'user');
        }
      };
    })(opt.num);
    optionGroup.appendChild(btn);
  }

  container.appendChild(optionGroup);
  messagesEl.appendChild(container);
  scrollToBottom();
  return container;
}
```

- [ ] **Step 3: Add option rendering to handleDone**

Update `handleDone` to check for options:

```javascript
function handleDone(fullText) {
  if (currentAiBubble && fullText) {
    var result = detectOptions(fullText);
    if (result) {
      // Remove the streaming bubble, render as option buttons
      currentAiBubble.remove();
      renderOptions(result, result.prefix);
    } else {
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.textContent = fullText;
    }
  }
  currentAiBubble = null;
  currentAiText = '';
  scrollToBottom();
  playBeep();
}
```

- [ ] **Step 4: Add option button styles**

Add to `public/style.css`:

```css
.option-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.option-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  color: #333;
  cursor: pointer;
  line-height: 1.4;
}

.option-btn:active:not(.disabled) {
  background: #e0e0e0;
}

.option-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 5: Manual test**

1. Run `node server.js`
2. Open browser, ask Claude "give me 3 options for caching strategies"
3. Verify: options render as clickable buttons (not plain text)
4. Verify: clicking an option sends it as a message
5. Verify: buttons become disabled after clicking
6. Verify: normal text replies still render as plain bubbles

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: add option button interaction for Claude's choices"
```

---

### Task 7: End-to-End Test and Polish

Verify all features work together and fix any issues.

**Files:**
- Modify: `server.js` (if needed)
- Modify: `public/app.js` (if needed)

- [ ] **Step 1: Test complete flow**

1. Start server: `node server.js --dir d:/workspace/agentapp`
2. Open browser, verify no session selection prompt
3. Send a simple message, verify streaming + beep
4. Send a message triggering tool use (e.g., "list files"), verify approval modal
5. Approve tool, verify Claude continues
6. Ask Claude to present options, verify option buttons
7. Click an option, verify Claude responds
8. Disconnect and reconnect, verify session resumes
9. Kill server, restart without --dir, verify session selection appears

- [ ] **Step 2: Fix any issues found during testing**

Address any bugs or UX issues discovered.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix: polish end-to-end integration of all new features"
```
