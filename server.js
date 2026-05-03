const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

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
