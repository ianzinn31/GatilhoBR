const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('[Test E2E] 🚀 Iniciando verificação completa da integração Betano...');

// 1. Validar BetanoAdapter e cleanMarketTitle
const BetanoAdapter = require('../src/adapters/betanoAdapter');
const adapter = new BetanoAdapter();

console.log('[Test E2E] 1. Testando limpeza de títulos de mercados corrompidos...');
const testCases = [
  {
    raw: 'CAResultado Final13.05X2.8522.55',
    expected: 'Resultado Final'
  },
  {
    raw: 'CATotal de GolsMais de 2.52.47Menos de 2.51.500pções Alternativas',
    expected: 'Total de Gols'
  },
  {
    raw: 'CAPróximo gol (Gol 1)América-MG2.15Sem Gol6.30São Bernardo2.02',
    expected: 'Próximo gol (Gol 1)'
  },
  {
    raw: 'CAResultado do 1° TempoAmérica-MG3.80Empate1.82São Bernardo3.40',
    expected: 'Resultado do 1° Tempo'
  },
  {
    raw: 'Criar Aposta Total de Gols - 1º Tempo',
    expected: 'Total de Gols - 1º Tempo'
  }
];

for (const tc of testCases) {
  const cleaned = adapter.cleanMarketTitle(tc.raw);
  assert.strictEqual(cleaned, tc.expected, `Esperado "${tc.expected}", mas obteve "${cleaned}"`);
}
console.log('  -> Limpeza de títulos 100% OK!');

// 2. Validar background.js
console.log('[Test E2E] 2. Verificando background.js para Betano...');
const bgCode = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf-8');

assert(bgCode.includes('if (lowerHouse.includes("betano")) return "betano";'), 'dynamicBindHouseKey deve conter betano');
assert(/houseKey\s*===\s*"betano"[\s\S]*?"Betano"/.test(bgCode), 'dynamicBindHouseName deve conter Betano');
assert(bgCode.includes('tab.url.includes("betano")'), 'tabs.onUpdated deve incluir betano em isBetting');
assert(/house\s*===\s*"betano"[\s\S]*?"Betano"[\s\S]*?"Bet365"/.test(bgCode), 'HOUSE_CONNECTED deve resolver Betano');
assert(/rawHouse\.includes\("betano"\)[\s\S]*?"betano"[\s\S]*?"bet365"/.test(bgCode), 'REQUEST_MARKETS deve resolver betano');
assert(bgCode.includes('"SELECT_ODDS_ACTION"'), 'NATIVE_BRIDGE_COMMAND_TYPES deve incluir SELECT_ODDS_ACTION');
console.log('  -> background.js 100% OK!');

// 3. Validar betano-dashboard-loader.js e bundle
console.log('[Test E2E] 3. Verificando patches do loader no bundle da dashboard...');
const loaderCode = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app', 'dist', 'betano-dashboard-loader.js'), 'utf-8');
const bundleCode = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app', 'dist', 'assets', 'index-bBFKOU_L.js'), 'utf-8');

// Extrair replacements do loader
const regex = /\["([^"]+)",\s*"([^"]+)"\]/g;
let match;
let count = 0;
while ((match = regex.exec(loaderCode)) !== null) {
  const fromStr = match[1];
  assert(bundleCode.includes(fromStr), `String do loader não encontrada no bundle: "${fromStr}"`);
  count++;
}
assert(count >= 14, `Esperado pelo menos 14 patches no loader, encontrado: ${count}`);
console.log(`  -> Todos os ${count} patches do loader correspondem exatamente ao bundle!`);

// 4. Validar CSS de odds-num
console.log('[Test E2E] 4. Verificando CSS de exibição numérica de odds...');
const cssCode = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app', 'dist', 'assets', 'index-CE0z2sp7.css'), 'utf-8');
assert(cssCode.includes('.odds-num{display:inline-flex;align-items:center;justify-content:center;'), 'odds-num deve ter display inline-flex e alinhamento centrado');
console.log('  -> CSS de odds-num 100% OK!');

console.log('\n🎉 TODOS OS TESTES E2E DA BETANO PASSARAM COM SUCESSO ABSOLUTO!');
