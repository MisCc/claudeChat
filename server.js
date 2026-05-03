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

function callClaude(ws, content) {
  isProcessing = true;
  ws.send(JSON.stringify({ type: 'status', content: 'thinking' }));

  const args = ['-p', content, '--output-format', 'stream-json', '--verbose'];
  if (currentSessionId) {
    args.push('--resume', currentSessionId);
  }

  const proc = spawn('claude', args, { shell: true });
  proc.stdin.end();
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
      callClaude(ws, msg.content);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
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

(async () => {
  await checkClaudeCli();

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
