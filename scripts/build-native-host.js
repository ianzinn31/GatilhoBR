#!/usr/bin/env node
/* Build the Native Messaging host into a standalone Windows executable. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-native');
const entry = path.join(root, 'native-host', 'gatilhobr-host.js');
const output = path.join(outDir, 'gatilhobr-host.exe');
fs.mkdirSync(outDir, { recursive: true });

// pkg is a dev dependency. Invoke its CLI directly so this also works in CI.
const bin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'pkg.cmd')
  : path.join(root, 'node_modules', '.bin', 'pkg');
// pkg currently ships Node 18 base binaries, which is sufficient for this stdio host.
const result = spawnSync(bin, [entry, '--targets', 'node18-win-x64', '--output', output], {
  cwd: root,
  stdio: 'inherit',
  // .cmd shims require a shell on Windows; direct binaries remain safe on POSIX.
  shell: process.platform === 'win32',
});
if (result.error || result.status !== 0) {
  console.error(`Native host build failed${result.error ? `: ${result.error.message}` : ''}`);
  process.exit(result.status || 1);
}
console.log(`Native host written to ${output}`);
