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
