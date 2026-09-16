'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Validação fail-closed antes do empacotamento ou lançamento.
 */
function validatePrerequisites(context = {}) {
  const { manifest, pkg, updateUrl, hostPath } = context;

  if (manifest) {
    if (!manifest.key || !manifest.key.trim()) {
      throw new Error('Empacotamento abortado (fail-closed): manifest.json não possui a chave pública "key".');
    }
  }

  if (pkg && manifest) {
    if (pkg.version !== manifest.version) {
      throw new Error(`Empacotamento abortado (fail-closed): versões discrepantes entre package.json (${pkg.version}) e manifest.json (${manifest.version}).`);
    }
  }

  if (updateUrl) {
    if (!updateUrl.startsWith('https://')) {
      throw new Error(`Empacotamento abortado (fail-closed): URL de atualização deve usar HTTPS: ${updateUrl}`);
    }
  }

  if (hostPath) {
    if (!fs.existsSync(hostPath)) {
      throw new Error(`Empacotamento abortado (fail-closed): Binário do host nativo não encontrado em: ${hostPath}`);
    }
  }

  return true;
}

/**
 * Hook afterPack para electron-builder garantir fail-closed
 */
async function afterPackHook(context) {
  const projectRoot = context.packager.projectDir;
  const manifestPath = path.join(projectRoot, 'manifest.json');
  const pkgPath = path.join(projectRoot, 'package.json');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const updateUrl = process.env.GBR_UPDATE_BASE_URL || 'https://releases.gatilhobr.com';

  validatePrerequisites({
    manifest,
    pkg,
    updateUrl
  });

  console.log('[Onboarding Launcher] ✅ Pré-requisitos validados com sucesso (fail-closed check OK).');
}

module.exports = afterPackHook;
module.exports.default = afterPackHook;
module.exports.validatePrerequisites = validatePrerequisites;
module.exports.afterPackHook = afterPackHook;
