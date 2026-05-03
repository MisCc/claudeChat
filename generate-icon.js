const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Simple PNG generator (no dependencies)
function createPNG(width, height, pixels) {
  // pixels is flat array [r,g,b,a, r,g,b,a, ...]

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makePNGChunk('IHDR', ihdrData);

  // IDAT
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      rawData[di] = pixels[si];
      rawData[di + 1] = pixels[si + 1];
      rawData[di + 2] = pixels[si + 2];
      rawData[di + 3] = pixels[si + 3];
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const idat = makePNGChunk('IDAT', compressed);

  // IEND
  const iend = makePNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function makePNGChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeB, data]);
  const crc = crc32(crcInput);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function createIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Rounded square mask
      const cornerR = size * 0.22;
      const inRect = x >= cornerR && x < size - cornerR && y >= cornerR && y < size - cornerR;
      const inCorner1 = dist(x, y, cornerR, cornerR) <= cornerR;
      const inCorner2 = dist(x, y, size - cornerR, cornerR) <= cornerR;
      const inCorner3 = dist(x, y, cornerR, size - cornerR) <= cornerR;
      const inCorner4 = dist(x, y, size - cornerR, size - cornerR) <= cornerR;

      if (inRect || inCorner1 || inCorner2 || inCorner3 || inCorner4) {
        // Claude green: #3AA86A with slight gradient
        const gradient = 1 - (y / size) * 0.15;
        pixels[i] = Math.round(58 * gradient);      // R
        pixels[i + 1] = Math.round(163 * gradient);  // G
        pixels[i + 2] = Math.round(105 * gradient);  // B
        pixels[i + 3] = 255;                          // A

        // Draw "C" letter
        const tx = (x - cx) / (size * 0.3);
        const ty = (y - cy) / (size * 0.3);

        // C shape: outer circle minus inner circle, open on right
        const outerR = 1.0;
        const innerR = 0.55;
        const d = dist(tx, ty, 0, 0);

        if (d <= outerR && d >= innerR) {
          // Only draw left portion (open on right side)
          const angle = Math.atan2(ty, tx);
          const openAngle = 0.5; // radians (~30 degrees) opening on right
          if (tx < size * 0.06 || Math.abs(angle) > openAngle + 0.3) {
            pixels[i] = 255;     // R
            pixels[i + 1] = 255; // G
            pixels[i + 2] = 255; // B
            pixels[i + 3] = 255; // A
          }
        }

        // Anti-aliasing at C edges
        if (d <= outerR + 0.08 && d >= innerR - 0.08) {
          const angle = Math.atan2(ty, tx);
          const openAngle = 0.5;
          const isRight = tx >= -0.08 && Math.abs(angle) <= openAngle + 0.38;

          if (!isRight) {
            const outerBlend = Math.min(1, Math.max(0, outerR + 0.08 - d) / 0.16);
            const innerBlend = Math.min(1, Math.max(0, d - innerR + 0.08) / 0.16);
            const blend = Math.max(outerBlend, innerBlend);
            if (blend > 0) {
              const g58 = 58, g163 = 163, g105 = 105;
              pixels[i] = Math.round(g58 * (1 - blend) + 255 * blend);
              pixels[i + 1] = Math.round(g163 * (1 - blend) + 255 * blend);
              pixels[i + 2] = Math.round(g105 * (1 - blend) + 255 * blend);
              pixels[i + 3] = 255;
            }
          }
        }
      } else {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0; // transparent
      }
    }
  }

  return createPNG(size, size, pixels);
}

// Generate multi-size ICO
const sizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = sizes.map(s => createIcon(s));

// ICO header
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);     // reserved
header.writeUInt16LE(1, 2);     // type: icon
header.writeUInt16LE(sizes.length, 4); // image count

let offset = 6 + sizes.length * 16;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i] < 256 ? sizes[i] : 0;
  header[entry + 1] = sizes[i] < 256 ? sizes[i] : 0;
  header[entry + 2] = 0;  // palette
  header[entry + 3] = 0;  // reserved
  header.writeUInt16LE(1, entry + 4);  // color planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(pngBuffers[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += pngBuffers[i].length;
}

const ico = Buffer.concat([header, ...pngBuffers]);
const icoPath = path.join(__dirname, 'claude-chat.ico');
fs.writeFileSync(icoPath, ico);
console.log('Icon created:', icoPath, '(' + ico.length + ' bytes)');
