#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(PROJECT_ROOT, 'dist-extension');

const EXCLUDE_NAMES = new Set([
  'node_modules',
  'dist-desktop',
  'dist-native',
  'dist-extension',
  'release',
  'tests',
  '.git',
  '.github',
  'scripts',
  'docs',
  'build',
  'test_asar_extract',
  'asar_tmp',
  'scratch',
  'package-lock.json',
  'package.json'
]);

function copyDirRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('scratch_') || entry.name === '{') continue;

    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function prepareExtensionBundle() {
  console.log('[Extension Bundle] Preparando pasta descompactada da extensão...');
  
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  copyDirRecursive(PROJECT_ROOT, TARGET_DIR);

  const manifestPath = path.join(TARGET_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Falha ao preparar extensão: manifest.json não encontrado no diretório de destino.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`[Extension Bundle] ✅ Extensão preparada com sucesso em: ${TARGET_DIR}`);
  console.log(`                   Versão: ${manifest.version} | ID: dkchfkmohlejeflkdfhinlfgbeihfegh`);

  return TARGET_DIR;
}

if (require.main === module) {
  try {
    prepareExtensionBundle();
  } catch (err) {
    console.error('[Extension Bundle] ❌ Erro:', err.message);
    process.exit(1);
  }
}

module.exports = { prepareExtensionBundle, TARGET_DIR };
