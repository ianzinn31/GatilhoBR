const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

console.log('[Test] 🔍 Verificando integrações declarativas...');

// 1. Verificações no background.js, manifest.json e content.js
assert.match(read('background.js'), /betano/i, 'background deve reconhecer a Betano');
assert.match(read('manifest.json'), /betano\.bet\.br/i, 'manifest deve declarar os domínios da Betano');
assert.match(read('content.js'), /isBetano/i, 'content.js deve identificar a Betano');
assert.match(read('content.js'), /pan-.*|live/i, 'content.js deve suportar rotas de jogos da Betano');
assert.ok(
  fs.existsSync(path.join(root, 'src', 'adapters', 'betanoAdapter.js')),
  'adapter Betano deve existir'
);

// 2. Verificações no Dashboard
const dashHtml = read('dashboard.html');
assert.ok(!dashHtml.includes('id="chk-house-betano" class="house-checkbox" disabled'), 'Betano não deve estar desabilitada no dashboard.html');
assert.ok(dashHtml.includes('id="status-betano"'), 'Badge de status da Betano deve existir no dashboard.html');

const dashJs = read('dashboard.js');
assert.ok(dashJs.includes('chkBetano.checked = houses.includes("betano")'), 'dashboard.js deve persistir a preferência da Betano');

// 3. Verificação no Cookie Manager
const cookieMgr = read('electron/cookie-manager.js');
assert.ok(cookieMgr.includes('betano.bet.br'), 'cookie-manager deve espelhar os domínios da Betano');

console.log('[Test] 🧪 Instanciando e testando o BetanoAdapter...');

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
require(path.join(root, 'src', 'adapters', 'betanoAdapter.js'));
const BetanoAdapter = global.window.BetanoAdapter;
assert.ok(BetanoAdapter, 'Classe BetanoAdapter deve estar exposta no window');

const adapter = new BetanoAdapter();
assert.equal(adapter.siteName, 'Betano');
assert.equal(BetanoAdapter.isMatchingSite('betano.bet.br'), true);
assert.equal(BetanoAdapter.isMatchingSite('www.betano.bet.br'), true);
assert.equal(BetanoAdapter.isMatchingSite('betfair.com'), false);

// 4. Testes do DOM mockado conforme a auditoria real da Betano
console.log('[Test] 🎯 Validando extração semântica da auditoria real...');

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
          const match = p.match(/\[class\*="?([^"\]]+)"?(\s*i)?\]/);
          if (match && (attrs.class || '').toLowerCase().includes(match[1].toLowerCase())) return true;
        }
        if (p.includes('[data-qa*=')) {
          const match = p.match(/\[data-qa\*="?([^"\]]+)"?(\s*i)?\]/);
          if (match && (attrs['data-qa'] || '').toLowerCase().includes(match[1].toLowerCase())) return true;
        }
        if (p.includes('[data-qa=')) {
          const match = p.match(/\[data-qa="?([^"\]]+)"?\]/);
          if (match && attrs['data-qa'] === match[1]) return true;
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
    getBoundingClientRect() { return { width: 100, height: 40 }; },
    isConnected: true,
    offsetWidth: 100,
    offsetHeight: 40,
  };
  for (const child of children) {
    child.parentElement = el;
  }
  return el;
}

// Mock de botão de seleção Over/Under: "Mais de 2.5" com odd 1.85
const nameSpan = createMockElement('span', {
  'data-qa': 'event-selection-selection-name',
  class: 'tw-truncate tw-text-s tw-text-sem-color-text-secondary'
}, 'Mais de 2.5');

const oddSpan = createMockElement('span', {
  class: 'tw-text-s tw-font-bold tw-text-sem-color-text-highlight'
}, '1.85');

const selectionBtn = createMockElement('div', {
  role: 'button',
  'data-qa': 'event-selection',
  'data-selnid': '10372658428',
  'aria-label': 'Bet on Mais de 2.5 with odds 1.85.',
  class: 'selection-horizontal-button tw-cursor-pointer'
}, 'Mais de 2.5\n1.85', [nameSpan, oddSpan]);

const marketCol = createMockElement('div', {
  'data-qa': 'table-market-column',
  class: 'tw-flex tw-flex-col'
}, 'Total de Gols Mais/Menos\nMais de 2.5\n1.85', [selectionBtn]);

// Teste de raspagem do botão mockado
global.document.querySelectorAll = (sel) => {
  if (sel.includes('event-selection')) return [selectionBtn];
  return [];
};
global.document.querySelector = (sel) => {
  if (sel.includes('10372658428')) return selectionBtn;
  return null;
};

const scraped = adapter.scrapeClean(marketCol);
assert.equal(scraped.length, 1, 'Deve extrair exatamente 1 mercado');
assert.equal(scraped[0].title, 'Total de Gols Mais/Menos', 'Título do mercado deve ser Total de Gols Mais/Menos');

const pick = scraped[0].participants[0];
assert.equal(pick.name, 'Mais de 2.5', 'Nome da seleção não deve ter a odd misturada');
assert.equal(pick.val, '1.85', 'Odd deve ser 1.85 e NÃO 2.5 (resolvendo o bug de Over/Under)');
assert.equal(pick.outcomeId, '10372658428', 'ID da seleção deve ser extraído do data-selnid');

// Teste de findOutcome com busca direta por outcomeId
const foundById = adapter.findOutcome('Mais de 2.5', '1.85', '10372658428');
assert.equal(foundById, selectionBtn, 'findOutcome deve localizar o elemento pelo data-selnid');

// Teste de stake e submit no betslip
const stakeInput = createMockElement('input', {
  type: 'text',
  'data-qa': 'betslip-stake-input',
  placeholder: '0,00'
}, '');

const submitBtn = createMockElement('button', {
  type: 'button',
  role: 'button',
  'data-qa': 'betslip-place-bet-button'
}, 'Apostar');

const betslipAside = createMockElement('aside', {
  id: 'right-sidebar',
  class: 'tw-flex tw-flex-col'
}, 'Panionios - Apollon Kalamarias\nMais de 2.5\n1.85\nApostar', [stakeInput, submitBtn]);

const foundStake = adapter.findStake(betslipAside);
assert.equal(foundStake, stakeInput, 'findStake deve encontrar o input data-qa="betslip-stake-input"');

const foundSubmit = adapter.findSubmit(betslipAside);
assert.equal(foundSubmit, submitBtn, 'findSubmit deve encontrar o botão data-qa="betslip-place-bet-button"');

// 5. Teste rigoroso simulando a página real do jogo (Inter de Milão x Udinese)
console.log('[Test] 🏟️ Simulando página real de jogo da Betano (Inter x Udinese)...');

function makeButton(text, odd, selnid, aria = '') {
  const nameSpan = createMockElement('span', {
    class: 'selection-horizontal-button__title'
  }, text, [
    createMockElement('span', { class: 's-name' }, text)
  ]);
  const priceSpan = createMockElement('span', {
    class: 'tw-font-bold tw-text-sem-color-text-highlight'
  }, odd);
  return createMockElement('div', {
    role: 'button',
    'data-qa': 'event-selection',
    'data-selnid': selnid,
    'aria-label': aria || `Bet on ${text} with odds ${odd}.`,
    class: 'selection-horizontal-button'
  }, `${text}\n${odd}`, [nameSpan, priceSpan]);
}

function makeAccordion(titleText, buttons) {
  const titleEl = createMockElement('div', { class: 'market-title' }, titleText);
  const badgeCa = createMockElement('span', { class: 'badge-ca' }, 'CA');
  const chevron = createMockElement('span', { class: 'chevron' }, '^');
  const header = createMockElement('div', {
    'data-qa': 'accordion-header',
    class: 'accordion-header tw-flex tw-items-center'
  }, `${titleText}\nCA\n^`, [titleEl, badgeCa, chevron]);

  const content = createMockElement('div', {
    class: 'accordion-content'
  }, '', buttons);

  return createMockElement('div', {
    'data-qa': 'market-accordion-item',
    class: 'accordion-item tw-flex tw-flex-col'
  }, '', [header, content]);
}

// 4 Mercados visíveis na captura do usuário
const rfButtons = [
  makeButton('1', '1.09', 'sel-rf-1'),
  makeButton('X', '8.00', 'sel-rf-x'),
  makeButton('2', '40.00', 'sel-rf-2')
];
const rfAccordion = makeAccordion('Resultado Final', rfButtons);

const tgButtons = [
  makeButton('Mais de 6.5', '2.05', 'sel-tg-65o'),
  makeButton('Menos de 6.5', '1.75', 'sel-tg-65u'),
  makeButton('Mais de 5.5', '1.22', 'sel-tg-55o'),
  makeButton('Menos de 5.5', '4.20', 'sel-tg-55u'),
  makeButton('Mais de 7.5', '4.25', 'sel-tg-75o'),
  makeButton('Menos de 7.5', '1.21', 'sel-tg-75u')
];
const tgAccordion = makeAccordion('Total de Gols', tgButtons);

const pgButtons = [
  makeButton('Inter de Milão', '1.52', 'sel-pg-1'),
  makeButton('Sem Gol', '4.20', 'sel-pg-x'),
  makeButton('Udinese', '5.20', 'sel-pg-2')
];
const pgAccordion = makeAccordion('Próximo gol (Gol 6)', pgButtons);

const cdButtons = [
  makeButton('Inter de Milão ou Empate', '1.007', 'sel-cd-1x'),
  makeButton('Inter de Milão ou Udinese', '1.07', 'sel-cd-12'),
  makeButton('Udinese ou Empate', '8.50', 'sel-cd-x2')
];
const cdAccordion = makeAccordion('Chance Dupla', cdButtons);

const allMockButtons = [...rfButtons, ...tgButtons, ...pgButtons, ...cdButtons];
const mockMatchPage = createMockElement('div', {
  'data-qa': 'table-markets-wrapper',
  class: 'markets-wrapper'
}, '', [rfAccordion, tgAccordion, pgAccordion, cdAccordion]);

global.document.querySelectorAll = (sel) => {
  if (sel.includes('event-selection')) return allMockButtons;
  return [];
};

// Força nova raspagem sem cache
adapter.lastScrapeAt = 0;
const liveScraped = adapter.scrapeClean(mockMatchPage);

assert.equal(liveScraped.length, 4, 'Deve extrair exatamente 4 mercados distintos (NÃO agrupados em "CA")');

// 1. Resultado Final
assert.equal(liveScraped[0].title, 'Resultado Final', 'Mercado 1 deve ser Resultado Final (e não "CA")');
assert.equal(liveScraped[0].participants.length, 3);
assert.equal(liveScraped[0].participants[0].name, '1');
assert.equal(liveScraped[0].participants[0].val, '1.09');
assert.equal(liveScraped[0].participants[1].name, 'X');
assert.equal(liveScraped[0].participants[1].val, '8.00');
assert.equal(liveScraped[0].participants[2].name, '2');
assert.equal(liveScraped[0].participants[2].val, '40.00');

// 2. Total de Gols (Over/Under com linhas)
assert.equal(liveScraped[1].title, 'Total de Gols', 'Mercado 2 deve ser Total de Gols (e não "CA")');
assert.equal(liveScraped[1].isTable, true, 'Total de Gols deve ser estruturado como tabela');
assert.equal(liveScraped[1].tableRows.length, 3, 'Total de Gols deve conter 3 linhas (5.5, 6.5, 7.5)');
assert.equal(liveScraped[1].tableRows[0].lineLabel, '5.5');
assert.equal(liveScraped[1].tableRows[1].lineLabel, '6.5');
assert.equal(liveScraped[1].tableRows[2].lineLabel, '7.5');
// Verifica que a odd e a linha NÃO foram invertidas
const tgPart0 = liveScraped[1].participants.find(p => p.outcomeId === 'sel-tg-65o');
assert.ok(tgPart0, 'Seleção Mais de 6.5 deve existir');
assert.equal(tgPart0.name, 'Mais de 6.5', 'Rótulo deve ser "Mais de 6.5" e NÃO "Mais de 2.05"');
assert.equal(tgPart0.val, '2.05', 'Odd deve ser "2.05" e NÃO "6.50"');

// 3. Próximo gol (Gol 6)
assert.equal(liveScraped[2].title, 'Próximo gol (Gol 6)');
assert.equal(liveScraped[2].participants.length, 3);
assert.equal(liveScraped[2].participants[0].name, 'Inter de Milão');
assert.equal(liveScraped[2].participants[0].val, '1.52');

// 4. Chance Dupla
assert.equal(liveScraped[3].title, 'Chance Dupla');
assert.equal(liveScraped[3].participants.length, 3);
assert.equal(liveScraped[3].participants[0].name, 'Inter de Milão ou Empate');
// 6. Teste com o layout real da página ao vivo (.markets__market com data-qa-market-type-id)
console.log('[Test] 🏟️ Testando layout nativo de mercados .markets__market (Deportivo Riestra x CA Lanús)...');

function makeMarketsMarket(titleText, marketTypeId, buttons) {
  const headerBtn = createMockElement('button', {
    class: 'markets__market__header tw-flex tw-items-center'
  }, `${titleText}\nCA\n^`, [
    createMockElement('div', { class: 'tw-self-center' }, titleText),
    createMockElement('span', { class: 'badge' }, 'CA')
  ]);
  const content = createMockElement('div', { class: 'selections-group' }, '', buttons);
  return createMockElement('div', {
    class: 'markets__market tw-rounded-n tw-relative',
    'data-qa-market-type-id': marketTypeId
  }, '', [headerBtn, content]);
}

const riestraRfButtons = [
  makeButton('1', '6.80', 'sel-riestra-1'),
  makeButton('X', '3.60', 'sel-riestra-x'),
  makeButton('2', '1.57', 'sel-riestra-2')
];
const riestraMarket = makeMarketsMarket('Resultado Final', '1', riestraRfButtons);

adapter.lastScrapeAt = 0;
global.document.querySelectorAll = (sel) => {
  if (sel.includes('event-selection')) return riestraRfButtons;
  return [];
};
const riestraScraped = adapter.scrapeClean(riestraMarket);
assert.equal(riestraScraped.length, 1, 'Deve agrupar 1 mercado para Resultado Final');
assert.equal(riestraScraped[0].title, 'Resultado Final', 'Título deve ser Resultado Final');
assert.equal(riestraScraped[0].participants.length, 3, 'Deve conter exatamente as 3 seleções (1, X, 2) no mesmo mercado');
assert.equal(riestraScraped[0].participants[0].name, '1');
assert.equal(riestraScraped[0].participants[0].val, '6.80');
assert.equal(riestraScraped[0].participants[1].name, 'X');
assert.equal(riestraScraped[0].participants[1].val, '3.60');
assert.equal(riestraScraped[0].participants[2].name, '2');
assert.equal(riestraScraped[0].participants[2].val, '1.57');

console.log('\n✅ TODOS OS TESTES DA BETANO PASSARAM COM 100% DE SUCESSO!\n');
