const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// PNG generator
function createPng(width, height, getPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const rawData = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const idatData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xFF];
  }
  return ~c >>> 0;
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

// 1. Betano SVG & PNG
const betanoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48">
  <rect width="48" height="48" rx="24" fill="#F05023"/>
  <path d="M19 13h10c3.5 0 6 1.8 6 4.8 0 2-1 3.5-2.7 4.2 2.2.7 3.7 2.4 3.7 5 0 3.5-2.8 5.5-6.5 5.5H19V13zm5.2 4.6v4.3h4.5c1.5 0 2.5-.8 2.5-2.1s-1-2.2-2.5-2.2h-4.5zm0 8.3v4.6h4.8c1.6 0 2.8-.9 2.8-2.3s-1.2-2.3-2.8-2.3h-4.8z" fill="#FFFFFF"/>
  <text x="58" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#FFFFFF" letter-spacing="-0.5">BETANO</text>
</svg>`;

// 2. BetMGM SVG & PNG
const betmgmSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48">
  <rect width="48" height="48" rx="10" fill="#18181B" stroke="#C5A059" stroke-width="2"/>
  <path d="M14 34V14h4.5l5.5 11 5.5-11H34v20h-4V21.5L24.5 32h-1L18 21.5V34h-4z" fill="#C5A059"/>
  <text x="58" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#C5A059" letter-spacing="-0.5">BetMGM</text>
</svg>`;

// Render Betano 80x80 round PNG
const betanoPng = createPng(80, 80, (x, y) => {
  const cx = 40, cy = 40;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (dist > 38) return [0, 0, 0, 0];
  
  // Desenho simples da letra B branca centralizada
  const isWhiteB = (
    // Coluna vertical da haste esquerda
    (x >= 24 && x <= 32 && y >= 20 && y <= 60) ||
    // Barra superior
    (x >= 24 && x <= 46 && y >= 20 && y <= 27) ||
    // Barra intermediária
    (x >= 24 && x <= 48 && y >= 36 && y <= 43) ||
    // Barra inferior
    (x >= 24 && x <= 46 && y >= 53 && y <= 60) ||
    // Curva superior direita
    (x >= 42 && x <= 50 && y >= 24 && y <= 39) ||
    // Curva inferior direita
    (x >= 42 && x <= 52 && y >= 40 && y <= 56)
  ) && !(
    // Furo superior
    (x >= 32 && x <= 42 && y >= 27 && y <= 36) ||
    // Furo inferior
    (x >= 32 && x <= 43 && y >= 43 && y <= 53)
  );

  if (isWhiteB) return [255, 255, 255, 255];
  return [240, 80, 35, 255]; // #F05023
});

// Render BetMGM 80x80 gold PNG
const betmgmPng = createPng(80, 80, (x, y) => {
  const cx = 40, cy = 40;
  if (x < 4 || x > 75 || y < 4 || y > 75) return [0, 0, 0, 0];
  
  // Borda dourada
  const isBorder = (x <= 7 || x >= 72 || y <= 7 || y >= 72);
  if (isBorder) return [197, 160, 89, 255]; // #C5A059

  // Letra M dourada centralizada
  const isGoldM = (
    (x >= 16 && x <= 22 && y >= 22 && y <= 58) ||
    (x >= 58 && x <= 64 && y >= 22 && y <= 58) ||
    (x >= 22 && x <= 40 && Math.abs((y - 22) - (x - 22) * 1.5) < 5 && y <= 52) ||
    (x >= 40 && x <= 58 && Math.abs((y - 22) - (58 - x) * 1.5) < 5 && y <= 52)
  );

  if (isGoldM) return [218, 185, 120, 255];
  return [20, 20, 24, 255]; // Fundo grafite luxo
});

const dirs = [
  'dashboard-app/dist',
  'asar_tmp/dashboard-app/dist'
];

for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    fs.writeFileSync(path.join(dir, 'betano-logo.png'), betanoPng);
    fs.writeFileSync(path.join(dir, 'betmgm-logo.png'), betmgmPng);
    fs.writeFileSync(path.join(dir, 'betano-logo.svg'), betanoSvg);
    fs.writeFileSync(path.join(dir, 'betmgm-logo.svg'), betmgmSvg);
    console.log(`Logos saved to ${dir}`);
  }
}
