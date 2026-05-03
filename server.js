const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

let messageHistory = [];

function spawnClaudeProcess(ws) {
  const args = ['--output-format', 'stream-json', '--verbose'];
  if (currentSessionId) {
    args.push('--resume', currentSessionId);
  }

  const spawnOpts = { shell: true };
  if (startDir) {
    spawnOpts.cwd = startDir;
  }

  const proc = spawn('claude', args, spawnOpts);
  const rl = readline.createInterface({ input: proc.stdout });

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

function handleClaudeOutput(ws, line) {
  try {
    const event = JSON.parse(line);

    if (event.type === 'assistant' && event.message && event.message.content) {
      for (let i = 0; i < event.message.content.length; i++) {
        const block = event.message.content[i];

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

const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

let currentSessionId = null;

function listSessions() {
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  try {
    const files = require('fs').readdirSync(sessionsDir);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(require('fs').readFileSync(path.join(sessionsDir, file), 'utf8'));
        if (data.sessionId) {
          sessions.push({
            sessionId: data.sessionId,
            cwd: data.cwd || '',
            startedAt: data.startedAt || 0,
          });
        }
      } catch (e) {}
    }
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    return sessions.slice(0, 10);
  } catch (e) {
    return [];
  }
}

function selectSession() {
  return new Promise((resolve) => {
    // Check --session-id flag first
    const sessionIdx = process.argv.indexOf('--session-id');
    if (sessionIdx !== -1 && process.argv[sessionIdx + 1]) {
      resolve(sessionIdx + 1);
      return;
    }

    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log('  No existing sessions found. Starting new session.\n');
      resolve(null);
      return;
    }

    console.log('\n  Available sessions:\n');
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const date = new Date(s.startedAt);
      const timeStr = date.toLocaleString();
      const cwdShort = s.cwd.replace(/^.*[\\\/]/, '');
      console.log(`    [${i + 1}] ${s.sessionId}`);
      console.log(`        ${timeStr}  (${cwdShort})`);
    }
    console.log(`\n    [0] New session\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Select session number: ', (answer) => {
      rl.close();
      const num = parseInt(answer, 10);
      if (num > 0 && num <= sessions.length) {
        resolve(sessions[num - 1].sessionId);
      } else {
        resolve(null);
      }
    });
  });
}
let isProcessing = false;
var startDir = null;
let pendingToolCalls = [];
let pendingApprovalCount = 0;
let fullResponse = '';

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Spawn Claude process for this connection
  const proc = spawnClaudeProcess(ws);
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
    let msg;
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

const PORT = process.env.PORT || 3001;
const lanIp = getLanIp();

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

function parseStartDir() {
  const dirIdx = process.argv.indexOf('--dir');
  if (dirIdx !== -1 && process.argv[dirIdx + 1]) {
    const dir = path.resolve(process.argv[dirIdx + 1]);
    try {
      const stat = require('fs').statSync(dir);
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

(async () => {
  await checkClaudeCli();

  startDir = parseStartDir();
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

    const url = `http://${lanIp}:${PORT}`;
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
