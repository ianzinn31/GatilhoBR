#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const crx3 = require('crx3');

/**
 * Deriva o ID de 32 caracteres da extensão Chromium a partir da chave pública RSA em Base64 (SPKI).
 */
function deriveExtensionId(pubKeyBase64) {
  if (!pubKeyBase64 || typeof pubKeyBase64 !== 'string') {
    throw new Error('Chave pública Base64 inválida.');
  }
  const der = Buffer.from(pubKeyBase64, 'base64');
  const hash = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
  let id = '';
  for (let i = 0; i < hash.length; i++) {
    const byte = hash[i];
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    id += String.fromCharCode(97 + high) + String.fromCharCode(97 + low);
  }
  return id;
}

/**
 * Copia recursivamente um diretório ou arquivo ignorando pastas e arquivos não relacionados à extensão.
 */
function copyExtensionFiles(sourceDir, targetDir) {
  const excludedNames = new Set([
    'node_modules',
    'dist-desktop',
    'dist-native',
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

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (excludedNames.has(entry.name)) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('scratch_') || entry.name === '{') continue;

    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyExtensionFiles(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Calcula o hash SHA-256 de um arquivo em formato hexadecimal.
 */
function getFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Executa o build de release da extensão gerando CRX, updates.xml e checksums.txt.
 */
async function buildRelease(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
  const channel = options.channel || process.env.GBR_CHANNEL || 'stable';
  const updateBaseUrl = (options.updateBaseUrl || process.env.GBR_UPDATE_BASE_URL || 'https://releases.gatilhobr.com').replace(/\/+$/, '');
  const outputDir = options.outputDir || path.join(projectRoot, 'release', channel);

  // 1. Validar URL HTTPS
  if (!updateBaseUrl.startsWith('https://')) {
    throw new Error(`updateBaseUrl deve usar HTTPS: ${updateBaseUrl}`);
  }

  // 2. Ler package.json e manifest.json
  const pkgPath = path.join(projectRoot, 'package.json');
  const manifestPath = path.join(projectRoot, 'manifest.json');

  if (!fs.existsSync(pkgPath)) throw new Error(`package.json não encontrado em ${pkgPath}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json não encontrado em ${manifestPath}`);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 3. Validação de paridade semver
  if (pkg.version !== manifest.version) {
    throw new Error(`Versão discrepante entre package.json (${pkg.version}) e manifest.json (${manifest.version}).`);
  }

  // 4. Validação de chave pública no manifest
  if (!manifest.key || !manifest.key.trim()) {
    throw new Error('Chave "key" obrigatória ausente no manifest.json.');
  }

  const extensionId = deriveExtensionId(manifest.key.trim());

  // 5. Determinar chave privada para assinatura
  let keyPath = options.privateKeyPath || process.env.GBR_EXTENSION_KEY_PATH;
  let isTempKey = false;
  let tempKeyFile = null;

  if (!keyPath || !fs.existsSync(keyPath)) {
    const projectKeyPath = path.join(projectRoot, 'release', 'key.pem');
    if (fs.existsSync(projectKeyPath)) {
      keyPath = projectKeyPath;
    } else {
      // Gera chave temporária se não especificada
      const tempKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbr-key-'));
      tempKeyFile = path.join(tempKeyDir, 'ephemeral-key.pem');
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      fs.writeFileSync(tempKeyFile, privateKey);
      keyPath = tempKeyFile;
      isTempKey = true;
      console.warn('[AVISO] Nenhuma chave privada fornecida. Usando chave temporária para empacotar CRX.');
    }
  }

  // 6. Preparar diretório temporário para arquivos da extensão
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbr-crx-staging-'));
  fs.mkdirSync(outputDir, { recursive: true });

  const crxFileName = `extension-v${pkg.version}.crx`;
  const crxPath = path.join(outputDir, crxFileName);
  const updatesXmlPath = path.join(outputDir, 'updates.xml');
  const checksumsPath = path.join(outputDir, 'checksums.txt');

  try {
    copyExtensionFiles(projectRoot, stagingDir);

    // 7. Empacotar CRX3
    await crx3([stagingDir], {
      keyPath: keyPath,
      crxPath: crxPath
    });

    // 8. Gerar updates.xml no formato padrão Chromium
    const codebase = `${updateBaseUrl}/${channel}/${crxFileName}`;
    const xmlContent = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${codebase}' version='${pkg.version}' />
  </app>
</gupdate>
`;
    fs.writeFileSync(updatesXmlPath, xmlContent, 'utf8');

    // 9. Gerar checksums.txt com SHA-256
    const crxHash = getFileSha256(crxPath);
    const xmlHash = getFileSha256(updatesXmlPath);

    const checksumsContent = [
      `${crxHash}  ${crxFileName}`,
      `${xmlHash}  updates.xml`,
      ''
    ].join('\n');
    fs.writeFileSync(checksumsPath, checksumsContent, 'utf8');

    console.log(`[OK] Release da extensão gerada com sucesso em: ${outputDir}`);
    console.log(`     - Extension ID: ${extensionId}`);
    console.log(`     - CRX: ${crxFileName} (${crxHash.slice(0, 16)}...)`);
    console.log(`     - Updates XML: ${updatesXmlPath}`);

    return {
      version: pkg.version,
      channel,
      extensionId,
      crxPath,
      updatesXmlPath,
      checksumsPath,
      crxHash,
      xmlHash
    };
  } finally {
    // Limpeza de staging e chave temporária
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
    if (isTempKey && tempKeyFile) {
      try { fs.rmSync(path.dirname(tempKeyFile), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

if (require.main === module) {
  buildRelease()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ERRO]', err.message);
      process.exit(1);
    });
}

/**
 * Valida a presença e integridade dos artefatos em um diretório de release.
 */
function validateReleaseArtifacts(options = {}) {
  const releaseDir = options.releaseDir;
  const version = options.version;
  const channel = options.channel || 'stable';

  const crxName = `extension-v${version}.crx`;
  const crxPath = path.join(releaseDir, crxName);
  const xmlPath = path.join(releaseDir, 'updates.xml');
  const checksumsPath = path.join(releaseDir, 'checksums.txt');

  const hasCrx = fs.existsSync(crxPath);
  const hasXml = fs.existsSync(xmlPath);
  const hasChecksums = fs.existsSync(checksumsPath);

  const errors = [];
  if (!hasCrx) errors.push(`CRX não encontrado em: ${crxPath}`);
  if (!hasXml) errors.push(`updates.xml não encontrado em: ${xmlPath}`);
  if (!hasChecksums) errors.push(`checksums.txt não encontrado em: ${checksumsPath}`);

  if (hasXml) {
    const xml = fs.readFileSync(xmlPath, 'utf8');
    if (!xml.includes('codebase=') || !xml.includes('https://')) {
      errors.push('updates.xml não possui codebase HTTPS válido');
    }
  }

  if (hasChecksums && hasCrx) {
    const checksums = fs.readFileSync(checksumsPath, 'utf8');
    const realCrxHash = getFileSha256(crxPath);
    if (!checksums.includes(realCrxHash)) {
      errors.push('Hash do CRX não corresponde ao registrado em checksums.txt');
    }
  }

  return {
    valid: errors.length === 0,
    hasCrx,
    hasXml,
    hasChecksums,
    channel,
    errors
  };
}

module.exports = {
  deriveExtensionId,
  buildRelease,
  copyExtensionFiles,
  getFileSha256,
  validateReleaseArtifacts
};
