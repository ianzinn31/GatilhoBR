const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkDir(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        count += checkDir(full);
      }
    } else if (entry.name.endsWith('.js')) {
      try {
        execSync(`node -c "${full}"`);
        count++;
      } catch (e) {
        console.error('SYNTAX ERROR in:', full);
        process.exit(1);
      }
    }
  }
  return count;
}

const liveDir = 'C:\\Users\\ialve\\AppData\\Local\\GatilhoBR\\chrome-extension';
console.log('Checking all JS files in', liveDir);
const total = checkDir(liveDir);
console.log(`ALL ${total} JS FILES IN LIVE EXTENSION HAVE 100% VALID SYNTAX!`);

const asarDir = path.resolve(__dirname, '../test_asar_extract');
console.log('Checking all JS files in', asarDir);
const totalAsar = checkDir(asarDir);
console.log(`ALL ${totalAsar} JS FILES IN ASAR EXTRACT HAVE 100% VALID SYNTAX!`);
