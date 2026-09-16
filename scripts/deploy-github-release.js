'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO_OWNER = 'ianzinn31';
const REPO_NAME = 'GatilhoBR';
const TAG_NAME = 'v4.3.0';
const RELEASE_NAME = 'GatilhoBR v4.3.0 - Instalador Oficial';
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 1. Obtém o token do GitHub Credential Manager
function getGitHubToken() {
  try {
    const output = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const match = output.match(/password=(.+)/);
    if (match) return match[1].trim();
  } catch (e) {
    console.error('[Token] Erro ao ler git credential:', e.message);
  }
  return process.env.GITHUB_TOKEN || null;
}

// Helper para chamadas HTTPS
function githubRequest({ hostname = 'api.github.com', path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method,
      headers: {
        'User-Agent': 'GatilhoBR-Deployer',
        'Accept': 'application/vnd.github+json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
        } catch (err) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data, error: err });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

// Upload de asset binário grande com stream
function uploadReleaseAsset({ uploadUrl, filePath, fileName, contentType, token }) {
  return new Promise((resolve, reject) => {
    const cleanUrl = uploadUrl.replace(/\{(\?.*)?\}$/, '');
    const urlObj = new URL(`${cleanUrl}?name=${encodeURIComponent(fileName)}`);
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;

    console.log(`[Upload] Enviando ${fileName} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)...`);

    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'User-Agent': 'GatilhoBR-Deployer',
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': fileSize,
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);

    const stream = fs.createReadStream(filePath);
    let uploadedBytes = 0;
    let lastPercent = 0;

    stream.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      const percent = Math.floor((uploadedBytes / fileSize) * 100);
      if (percent >= lastPercent + 20) {
        lastPercent = percent;
        console.log(`[Upload ${fileName}] Progresso: ${percent}%`);
      }
    });

    stream.pipe(req);
  });
}

async function main() {
  console.log('====================================================');
  console.log('   GatilhoBR - Criação de Repositório & Releases   ');
  console.log('====================================================\n');

  const token = getGitHubToken();
  if (!token) {
    throw new Error('Token do GitHub não encontrado nas credenciais do sistema.');
  }

  // 1. Verifica se o repositório já existe no GitHub
  console.log(`[1/5] Verificando existência de ${REPO_OWNER}/${REPO_NAME} no GitHub...`);
  const checkRepo = await githubRequest({
    path: `/repos/${REPO_OWNER}/${REPO_NAME}`,
    headers: { Authorization: `Bearer ${token}` }
  });

  if (checkRepo.status === 200) {
    console.log(`[OK] Repositório ${REPO_OWNER}/${REPO_NAME} já existe: ${checkRepo.data.html_url}`);
  } else if (checkRepo.status === 404) {
    console.log(`[Criando] Criando repositório público ${REPO_NAME} no GitHub...`);
    const createRes = await githubRequest({
      path: '/user/repos',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: {
        name: REPO_NAME,
        description: 'GatilhoBR Desktop - Sincronizador e Disparador de Apostas Esportivas de Alta Performance',
        private: false,
        has_issues: true,
        has_projects: true,
        has_wiki: false
      }
    });

    if (createRes.status === 201) {
      console.log(`[OK] Repositório criado com sucesso: ${createRes.data.html_url}`);
    } else {
      throw new Error(`Falha ao criar repositório: ${JSON.stringify(createRes.data)}`);
    }
  } else {
    throw new Error(`Erro inesperado ao verificar repositório: ${checkRepo.status}`);
  }

  // 2. Inicializa o Git localmente e configura remote
  console.log('\n[2/5] Configurando Git local e branch main...');
  const gitDir = path.join(PROJECT_ROOT, '.git');
  if (!fs.existsSync(gitDir)) {
    execSync('git init -b main', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  } else {
    try { execSync('git branch -M main', { cwd: PROJECT_ROOT, stdio: 'ignore' }); } catch (_) {}
  }

  const remoteUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}.git`;
  try {
    execSync('git remote remove origin', { cwd: PROJECT_ROOT, stdio: 'ignore' });
  } catch (_) {}
  execSync(`git remote add origin ${remoteUrl}`, { cwd: PROJECT_ROOT, stdio: 'inherit' });

  // 3. Adiciona arquivos e faz o primeiro commit
  console.log('\n[3/5] Fazendo commit dos arquivos do projeto...');
  execSync('git add .', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  
  try {
    execSync('git commit -m "feat: release v4.3.0 - GatilhoBR Desktop & Extension"', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
  } catch (_) {
    console.log('[Info] Nenhum arquivo alterado para commit.');
  }

  console.log('\n[4/5] Enviando código para o GitHub (git push origin main)...');
  execSync('git push -u origin main --force', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  console.log(`[OK] Código enviado com sucesso para ${remoteUrl}!`);

  // 4. Cria a Release v4.3.0 no GitHub
  console.log('\n[5/5] Criando GitHub Release ' + TAG_NAME + '...');
  const releaseBody = `## 🚀 GatilhoBR Desktop v4.3.0

Versão oficial e limpa para sincronização e disparo de apostas esportivas de alta performance.

### 📦 Downloads Oficiais:
- **Instalador Completo para Windows (Recomendado):** [GatilhoBR Setup 4.3.0.exe](https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${TAG_NAME}/GatilhoBR.Setup.4.3.0.exe)
- **Versão Portátil:** [GatilhoBR 4.3.0.exe](https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${TAG_NAME}/GatilhoBR.4.3.0.exe)

### ✨ Recursos:
- Disparo instantâneo com latência mínima em todas as casas suportadas.
- Integração nativa de alta fidelidade com Google Chrome e Microsoft Edge.
- Guia de boas-vindas simplificado em 3 passos para novos usuários.`;

  // Checa se release já existe
  const getRelease = await githubRequest({
    path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${TAG_NAME}`,
    headers: { Authorization: `Bearer ${token}` }
  });

  let releaseData = null;
  if (getRelease.status === 200) {
    console.log(`[Info] Release ${TAG_NAME} já existe. Atualizando...`);
    releaseData = getRelease.data;
  } else {
    const createRelease = await githubRequest({
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: {
        tag_name: TAG_NAME,
        target_commitish: 'main',
        name: RELEASE_NAME,
        body: releaseBody,
        draft: false,
        prerelease: false
      }
    });

    if (createRelease.status === 201) {
      console.log(`[OK] Release ${TAG_NAME} criada: ${createRelease.data.html_url}`);
      releaseData = createRelease.data;
    } else {
      throw new Error(`Falha ao criar release: ${JSON.stringify(createRelease.data)}`);
    }
  }

  // 5. Upload dos executáveis do instalador
  const setupExe = path.join(PROJECT_ROOT, 'dist-desktop', 'GatilhoBR Setup 4.3.0.exe');
  const portableExe = path.join(PROJECT_ROOT, 'dist-desktop', 'GatilhoBR 4.3.0.exe');

  if (fs.existsSync(setupExe)) {
    // Se o asset já existir, remove antes de re-upar
    if (releaseData.assets && releaseData.assets.length > 0) {
      for (const asset of releaseData.assets) {
        if (asset.name === 'GatilhoBR.Setup.4.3.0.exe' || asset.name === 'GatilhoBR Setup 4.3.0.exe') {
          console.log(`[Asset] Removendo versão anterior de ${asset.name}...`);
          await githubRequest({
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${asset.id}`,
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      }
    }

    const upRes = await uploadReleaseAsset({
      uploadUrl: releaseData.upload_url,
      filePath: setupExe,
      fileName: 'GatilhoBR.Setup.4.3.0.exe',
      contentType: 'application/octet-stream',
      token
    });
    console.log('[OK] GatilhoBR.Setup.4.3.0.exe enviado para a Release! Status:', upRes.status);
  }

  if (fs.existsSync(portableExe)) {
    if (releaseData.assets && releaseData.assets.length > 0) {
      for (const asset of releaseData.assets) {
        if (asset.name === 'GatilhoBR.4.3.0.exe' || asset.name === 'GatilhoBR 4.3.0.exe') {
          console.log(`[Asset] Removendo versão anterior de ${asset.name}...`);
          await githubRequest({
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${asset.id}`,
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      }
    }

    const upResPortable = await uploadReleaseAsset({
      uploadUrl: releaseData.upload_url,
      filePath: portableExe,
      fileName: 'GatilhoBR.4.3.0.exe',
      contentType: 'application/octet-stream',
      token
    });
    console.log('[OK] GatilhoBR.4.3.0.exe enviado para a Release! Status:', upResPortable.status);
  }

  console.log('\n====================================================');
  console.log('🎉 PROJETO E RELEASES PUBLICADOS COM SUCESSO!');
  console.log('====================================================');
  console.log(`🌐 Repositório: https://github.com/${REPO_OWNER}/${REPO_NAME}`);
  console.log(`🏷️ Página de Releases: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
  console.log(`⬇️ LINK DIRETO DO INSTALADOR (Colocar no seu botão de download):`);
  console.log(`👉 https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${TAG_NAME}/GatilhoBR.Setup.4.3.0.exe`);
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ ERRO NO DEPLOY:', err);
  process.exit(1);
});
