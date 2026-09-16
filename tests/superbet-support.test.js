const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

console.log('[Test Superbet] 🔍 Verificando integrações declarativas...');

// 1. Verificações no background.js, manifest.json e content.js
assert.match(read('background.js'), /superbet/i, 'background deve reconhecer a Superbet');
assert.match(read('manifest.json'), /superbet\.bet\.br/i, 'manifest deve declarar os domínios da Superbet');
assert.match(read('content.js'), /isSuperbet/i, 'content.js deve identificar a Superbet');
assert.match(read('electron/preload-house.js'), /isSuperbet/i, 'preload-house.js deve injetar o adapter da Superbet');
assert.match(read('src/quickExecEngine.js'), /selectOddsOnSuperbet/i, 'quickExecEngine deve despachar para selectOddsOnSuperbet');
assert.match(read('src/config.js'), /selectOddsOnSuperbet/i, 'config.js deve conter rota para Superbet');
assert.ok(
  fs.existsSync(path.join(root, 'src', 'adapters', 'superbetAdapter.js')),
  'adapter Superbet deve existir em src/adapters/superbetAdapter.js'
);

console.log('[Test Superbet] 🧪 Instanciando e testando o SuperbetAdapter...');

// Mock de ambiente de navegador para testar o Adapter em Node
global.window = global;
global.document = {
  body: {},
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.HTMLInputElement = class {};
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  set() {},
  get() { return ''; },
  configurable: true,
});

// Carrega o adaptador
require(path.join(root, 'src', 'adapters', 'superbetAdapter.js'));
const SuperbetAdapter = global.window.SuperbetAdapter;
assert.ok(SuperbetAdapter, 'Classe SuperbetAdapter deve estar exposta no window');

const adapter = new SuperbetAdapter();
assert.equal(adapter.siteName, 'Superbet');
assert.equal(SuperbetAdapter.isMatchingSite('superbet.bet.br'), true);
assert.equal(SuperbetAdapter.isMatchingSite('www.superbet.bet.br'), true);
assert.equal(SuperbetAdapter.isMatchingSite('superbet.com'), true);
assert.equal(SuperbetAdapter.isMatchingSite('betfair.com'), false);

// 2. Testes de DOM mockado da Superbet
console.log('[Test Superbet] 🎯 Validando extração semântica da Superbet...');

function createMockElement(tag, attrs = {}, text = '', children = []) {
  const el = {
    tagName: tag.toUpperCase(),
    attributes: attrs,
    _text: text,
    get innerText() {
      if (this._text) return this._text;
      return this.children.map(c => c.innerText).filter(Boolean).join('\n');
    },
    set innerText(v) { this._text = v; },
    get textContent() { return this.innerText; },
    children: [...children],
    parentElement: null,
    disabled: Boolean(attrs.disabled),
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = String(val); },
    classList: {
      contains(c) { return (attrs.class || '').split(/\s+/).includes(c); }
    },
    matches(sel) {
      if (!sel) return false;
      const parts = sel.split(',').map(s => s.trim());
      for (const p of parts) {
        if (p.startsWith('.')) {
          const cls = p.slice(1);
          if (this.classList.contains(cls)) return true;
        }
        if (p.includes('[class*=')) {
          const tagPrefix = p.split('[')[0].trim();
          if (tagPrefix && tagPrefix.toUpperCase() !== this.tagName) continue;
          const match = p.match(/\[class\*="?([^"\]]+)"?(\s*i)?\]/);
          if (match && (attrs.class || '').toLowerCase().includes(match[1].toLowerCase())) return true;
        }
        if (p.includes('[data-testid*=')) {
          const match = p.match(/\[data-testid\*="?([^"\]]+)"?(\s*i)?\]/);
          if (match && (attrs['data-testid'] || '').toLowerCase().includes(match[1].toLowerCase())) return true;
        }
        if (p.includes('[data-testid=')) {
          const match = p.match(/\[data-testid="?([^"\]]+)"?\]/);
          if (match && attrs['data-testid'] === match[1]) return true;
        }
        if (p.toUpperCase() === this.tagName) return true;
      }
      return false;
    },
    querySelector(sel) {
      const parts = sel.split(',').map(s => s.trim());
      for (const child of this.children) {
        for (const p of parts) {
          if (child.matches(p)) return child;
        }
        const found = child.querySelector(sel);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      const parts = sel.split(',').map(s => s.trim());
      for (const child of this.children) {
        for (const p of parts) {
          if (child.matches(p) && !results.includes(child)) {
            results.push(child);
          }
        }
        results.push(...child.querySelectorAll(sel));
      }
      return results;
    },
    closest(sel) {
      let cur = this;
      const parts = sel.split(',').map(s => s.trim());
      while (cur) {
        for (const p of parts) {
          if (cur.matches(p)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
    contains(other) {
      let cur = other ? other.parentElement : null;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    getBoundingClientRect() { return { left: 10, top: 20, width: 120, height: 40 }; },
    isConnected: true,
    offsetWidth: 120,
    offsetHeight: 40,
    focus() {},
    click() { this._clicked = true; },
    dispatchEvent(e) { return true; },
  };
  for (const child of children) {
    child.parentElement = el;
  }
  return el;
}

// Simulação de botão de odd na Superbet
const oddNameSpan = createMockElement('span', { class: 'odd__label' }, 'Mais de 2.5');
const oddValSpan = createMockElement('span', { class: 'odd__value' }, '1.92');
const oddButton = createMockElement('button', {
  'data-testid': 'odd-button',
  'data-outcome-id': 'sb-outcome-12345',
  class: 'odd-button odd'
}, 'Mais de 2.5\n1.92', [oddNameSpan, oddValSpan]);

const marketTitleHeader = createMockElement('h3', { class: 'market-title' }, 'Total de Gols');
const marketCard = createMockElement('div', { class: 'market-card market' }, '', [marketTitleHeader, oddButton]);

// Teste de raspagem
global.document.querySelectorAll = (sel) => {
  if (sel.includes('odd') || sel.includes('outcome')) return [oddButton];
  return [];
};
global.document.querySelector = (sel) => {
  if (sel.includes('sb-outcome-12345')) return oddButton;
  return null;
};

const scraped = adapter.scrapeClean(marketCard);
assert.equal(scraped.length, 1, 'Deve extrair exatamente 1 mercado da Superbet');
assert.equal(scraped[0].title, 'Total de Gols', 'Título do mercado deve ser Total de Gols');

const pick = scraped[0].participants[0];
assert.equal(pick.name, 'Mais de 2.5', 'Nome da seleção extraído corretamente');
assert.equal(pick.val, '1.92', 'Odd extraída corretamente');
assert.equal(pick.outcomeId, 'sb-outcome-12345', 'outcomeId extraído corretamente');

// Teste de findOutcome por ID
const found = adapter.findOutcome('Mais de 2.5', '1.92', 'sb-outcome-12345');
assert.equal(found, oddButton, 'Deve localizar botão pelo outcomeId');

// Teste de findOutcome por Nome e Odd
const foundByName = adapter.findOutcome('Mais de 2.5', '1.92');
assert.equal(foundByName, oddButton, 'Deve localizar botão por nome e odd');

// 3. Teste de Mercado Tabular (Total de Gols com Linhas e Mais/Menos)
console.log('[Test Superbet] 📊 Testando extração de Mercado Tabular (Total de Gols)...');
const headerTotalGols = createMockElement('div', { class: 'market-header-base__name' }, 'Total de Gols');
const headerItemMais = createMockElement('div', { class: 'market-layout-card__header-item' }, 'Mais');
const headerItemMenos = createMockElement('div', { class: 'market-layout-card__header-item' }, 'Menos');

// Linha 1.5
const spec15 = createMockElement('div', { class: 'market-layout-card__row-specifier' }, '1.5');
const btn15Mais = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Total de Gols, Mais de 1.5 gols na partida, coeficiente 1.25, active',
  'data-outcome-id': 'sb-15-over'
}, '1.25', [createMockElement('span', { class: 'odd-button__odd-value' }, '1.25')]);
const btn15Menos = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Total de Gols, Menos de 1.5 gols na partida, coeficiente 3.80, active',
  'data-outcome-id': 'sb-15-under'
}, '3.80', [createMockElement('span', { class: 'odd-button__odd-value' }, '3.80')]);
const row15 = createMockElement('div', { class: 'market-layout-card__row' }, '', [spec15, btn15Mais, btn15Menos]);

// Linha 2.5
const spec25 = createMockElement('div', { class: 'market-layout-card__row-specifier' }, '2.5');
const btn25Mais = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Total de Gols, Mais de 2.5 gols na partida, coeficiente 1.85, active',
  'data-outcome-id': 'sb-25-over'
}, '1.85', [createMockElement('span', { class: 'odd-button__odd-value' }, '1.85')]);
const btn25Menos = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Total de Gols, Menos de 2.5 gols na partida, coeficiente 1.95, active',
  'data-outcome-id': 'sb-25-under'
}, '1.95', [createMockElement('span', { class: 'odd-button__odd-value' }, '1.95')]);
const row25 = createMockElement('div', { class: 'market-layout-card__row' }, '', [spec25, btn25Mais, btn25Menos]);

// Container pai com classe repetida (market-layout-card__row) que contém as linhas filhas
const wrapperRow = createMockElement('div', { class: 'market-layout-card__row wrapper' }, '', [row15, row25]);

const totalGolsCard = createMockElement('div', { class: 'market-layout-card' }, '', [
  headerTotalGols,
  headerItemMais,
  headerItemMenos,
  wrapperRow
]);

const scrapedTotalGols = adapter.scrapeClean(totalGolsCard);
assert.equal(scrapedTotalGols.length, 1, 'Deve extrair mercado Total de Gols');
const tg = scrapedTotalGols[0];
assert.equal(tg.title, 'Total de Gols', 'Título deve ser Total de Gols');
assert.equal(tg.isTable, true, 'Deve ser marcado como isTable: true');
assert.equal(tg.tableRows.length, 2, 'Deve conter exatamente 2 linhas (1.5 e 2.5), sem duplicar wrapper');
assert.equal(tg.tableRows[0].lineLabel, '1.5', 'Primeira linha deve ser 1.5');
assert.equal(tg.tableRows[0].colOdds[0].colHeader, 'Mais', 'Primeira coluna da linha 1.5 deve ser Mais');
assert.equal(tg.tableRows[0].colOdds[0].val, '1.25', 'Odd Mais 1.5 deve ser 1.25');
assert.equal(tg.tableRows[0].colOdds[1].colHeader, 'Menos', 'Segunda coluna da linha 1.5 deve ser Menos');
assert.equal(tg.tableRows[0].colOdds[1].val, '3.80', 'Odd Menos 1.5 deve ser 3.80');

assert.equal(tg.tableRows[1].lineLabel, '2.5', 'Segunda linha deve ser 2.5');
assert.equal(tg.tableRows[1].colOdds[0].colHeader, 'Mais', 'Primeira coluna da linha 2.5 deve ser Mais');
assert.equal(tg.tableRows[1].colOdds[0].val, '1.85', 'Odd Mais 2.5 deve ser 1.85');

// 4. Teste de Mercado de Jogadores Multi-colunas (.three-column-over-market)
console.log('[Test Superbet] 🏃 Testando extração de Mercado de Jogadores Multi-colunas...');
const playerHeader = createMockElement('div', { class: 'market-header-base__name' }, 'Finalizações no Gol');

// Sidebar de jogadores
const player1 = createMockElement('div', { class: 'player' }, 'Vegetti, Pablo');
const player2 = createMockElement('div', { class: 'player' }, 'Payet, Dimitri');
const playerSidebar = createMockElement('div', { class: 'market-sidebar' }, '', [player1, player2]);

// Coluna 1: 0.5+
const col1Header = createMockElement('div', { class: 'column-total' }, '0.5+');
const btnP1C1 = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Finalizações no Gol, Vegetti, Pablo Mais de 0.5, coeficiente 1.45',
  'data-outcome-id': 'sb-p1-c1'
}, '1.45', [createMockElement('span', { class: 'odd-button__odd-value' }, '1.45')]);
const btnP2C1 = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Finalizações no Gol, Payet, Dimitri Mais de 0.5, coeficiente 1.70',
  'data-outcome-id': 'sb-p2-c1'
}, '1.70', [createMockElement('span', { class: 'odd-button__odd-value' }, '1.70')]);
const col1 = createMockElement('div', { class: 'column' }, '', [col1Header, btnP1C1, btnP2C1]);

// Coluna 2: 1.5+
const col2Header = createMockElement('div', { class: 'column-total' }, '1.5+');
const btnP1C2 = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Finalizações no Gol, Vegetti, Pablo Mais de 1.5, coeficiente 2.90',
  'data-outcome-id': 'sb-p1-c2'
}, '2.90', [createMockElement('span', { class: 'odd-button__odd-value' }, '2.90')]);
const btnP2C2 = createMockElement('button', {
  class: 'odd-button',
  'aria-label': 'Finalizações no Gol, Payet, Dimitri Mais de 1.5, coeficiente 3.50',
  'data-outcome-id': 'sb-p2-c2'
}, '3.50', [createMockElement('span', { class: 'odd-button__odd-value' }, '3.50')]);
const col2 = createMockElement('div', { class: 'column' }, '', [col2Header, btnP1C2, btnP2C2]);

const playerColumns = createMockElement('div', { class: 'market-columns' }, '', [col1, col2]);
const playerCard = createMockElement('div', { class: 'single-market-card three-column-over-market' }, '', [
  playerHeader,
  playerSidebar,
  playerColumns
]);

const scrapedPlayer = adapter.scrapeClean(playerCard);
assert.equal(scrapedPlayer.length, 1, 'Deve extrair mercado de jogadores');
const pm = scrapedPlayer[0];
assert.equal(pm.title, 'Finalizações no Gol', 'Título deve ser Finalizações no Gol');
assert.equal(pm.isPlayerMarket, true, 'Deve ser marcado como isPlayerMarket: true');
assert.equal(pm.isTable, true, 'Deve ser marcado como isTable: true');
assert.equal(pm.tableRows.length, 2, 'Deve ter 2 linhas de jogadores');
assert.equal(pm.tableRows[0].lineLabel, 'Vegetti, Pablo', 'Linha 1 deve ser Vegetti, Pablo');
assert.equal(pm.tableRows[0].colOdds[0].colHeader, '0.5+', 'Coluna 1 do jogador 1 deve ser 0.5+');
assert.equal(pm.tableRows[0].colOdds[0].val, '1.45', 'Odd 0.5+ deve ser 1.45');
assert.equal(pm.tableRows[0].colOdds[1].colHeader, '1.5+', 'Coluna 2 do jogador 1 deve ser 1.5+');
assert.equal(pm.tableRows[0].colOdds[1].val, '2.90', 'Odd 1.5+ deve ser 2.90');

assert.equal(pm.tableRows[1].lineLabel, 'Payet, Dimitri', 'Linha 2 deve ser Payet, Dimitri');
assert.equal(pm.tableRows[1].colOdds[0].val, '1.70', 'Odd 0.5+ de Payet deve ser 1.70');

console.log('✅ TODOS OS TESTES DE SUPORTE DA SUPERBET PASSARAM COM SUCESSO!');
