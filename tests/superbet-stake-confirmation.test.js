const assert = require('node:assert/strict');
const path = require('node:path');

console.log('[Test Superbet Stake & Confirm] 🚀 Iniciando testes de preenchimento e confirmação instantânea da Superbet...');

// Mock de ambiente DOM
global.window = global;
global.Event = class { constructor(type, init) { this.type = type; this.bubbles = init?.bubbles; } };
global.KeyboardEvent = class extends global.Event { constructor(type, init) { super(type, init); this.key = init?.key; } };
global.PointerEvent = class extends global.Event { constructor(type, init) { super(type, init); } };
global.MouseEvent = class extends global.Event { constructor(type, init) { super(type, init); } };
global.HTMLInputElement = class {};

function createMockElement(tag, attrs = {}, text = '', children = []) {
  const el = {
    tagName: tag.toUpperCase(),
    attributes: attrs,
    _text: text,
    value: attrs.value || '',
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
    getBoundingClientRect() { return { left: 10, top: 20, width: 120, height: 40 }; },
    isConnected: true,
    offsetWidth: 120,
    offsetHeight: 40,
    focus() { this._focused = true; },
    blur() { this._blurred = true; },
    click() { this._clicked = true; },
    dispatchEvent(e) { this._lastEvent = e; return true; },
  };
  for (const child of children) {
    child.parentElement = el;
  }
  return el;
}

global.document = {
  body: createMockElement('body'),
  querySelector: () => null,
  querySelectorAll: () => [],
};

// Carrega o adaptador
require(path.join(__dirname, '..', 'src', 'adapters', 'superbetAdapter.js'));
const SuperbetAdapter = global.window.SuperbetAdapter;
const adapter = new SuperbetAdapter();

// 1. Teste de busca de Stake Input
console.log('[Test] 1. Testando busca de input de Stake...');
const stakeInput1 = createMockElement('input', {
  'data-testid': 'ticket-stake-input',
  type: 'text',
  placeholder: '0,00'
});
global.document.querySelector = (sel) => {
  if (sel.includes('stake') || sel.includes('ticket-stake')) return stakeInput1;
  return null;
};
assert.equal(adapter.findStake(), stakeInput1, 'findStake deve encontrar input com data-testid ticket-stake');
console.log('  -> findStake com data-testid 100% OK!');

// 2. Teste de injectStakeValue
console.log('[Test] 2. Testando injectStakeValue...');
adapter.injectStakeValue(stakeInput1, '15,00');
assert.equal(stakeInput1.value, '15,00', 'injectStakeValue deve definir o valor');
assert.equal(stakeInput1._focused, true, 'input deve ter recebido foco');
assert.equal(stakeInput1._blurred, true, 'input deve ter recebido blur');
console.log('  -> injectStakeValue 100% OK!');

// 3. Teste de busca do botão de Aposta (Submit)
console.log('[Test] 3. Testando busca do botão de Aposta (Submit)...');
const submitBtn1 = createMockElement('button', {
  'data-testid': 'ticket-submit-button',
  class: 'ticket__submit btn-bet'
}, 'Apostar');

const submitBtn2 = createMockElement('button', {
  'data-testid': 'ticket-submit-button',
  class: 'ticket__submit btn-bet'
}, 'Fazer Aposta');

const submitBtn3 = createMockElement('button', {
  'data-testid': 'place-bet-btn'
}, 'Apostar R$ 15,00');

global.document.querySelectorAll = (sel) => {
  if (sel.includes('button') || sel.includes('place-bet')) return [submitBtn1];
  return [];
};
assert.equal(adapter.findSubmit(), submitBtn1, 'Deve reconhecer botão com texto "Apostar"');

global.document.querySelectorAll = (sel) => {
  if (sel.includes('button')) return [submitBtn2];
  return [];
};
assert.equal(adapter.findSubmit(), submitBtn2, 'Deve reconhecer botão com texto "Fazer Aposta"');

global.document.querySelectorAll = (sel) => {
  if (sel.includes('button')) return [submitBtn3];
  return [];
};
assert.equal(adapter.findSubmit(), submitBtn3, 'Deve reconhecer botão com texto "Apostar R$ 15,00"');
console.log('  -> findSubmit com todos os rótulos de aposta 100% OK!');

// 3.1 Testando rejeição estrita de botões auxiliares
console.log('[Test] 3.1 Testando rejeição estrita de botões de configurações/lixeira/depósito...');
const settingsBtn = createMockElement('button', {
  'aria-label': 'Configurações do bilhete',
  class: 'ticket-settings'
}, '⚙️');
const trashBtn = createMockElement('button', {
  'aria-label': 'Limpar bilhete',
  class: 'ticket-clear'
}, '🗑️');

global.document.querySelectorAll = (sel) => {
  if (sel.includes('button')) return [settingsBtn, trashBtn, submitBtn1];
  return [];
};
const foundSubmit = adapter.findSubmit();
assert.equal(foundSubmit, submitBtn1, 'Deve selecionar apenas o botão de Apostar, ignorando configurações e lixeira');
console.log('  -> Rejeição de botões secundários 100% OK!');

// 4. Teste de fluxo completo triggerPlaceBet
console.log('[Test] 4. Testando fluxo completo triggerPlaceBet...');
global.window.FastTriggerExternalElectronMode = true;
global.window.FastTriggerConfig = { stakeVal: '25,00', oneClick: true };

global.document.querySelector = (sel) => {
  if (sel.includes('stake') || sel.includes('ticket-stake') || sel.includes('input')) return stakeInput1;
  if (sel.includes('place-bet') || sel.includes('ticket-submit') || sel.includes('btn-bet')) return submitBtn1;
  return null;
};
global.document.querySelectorAll = (sel) => {
  if (sel.includes('button') || sel.includes('place-bet')) return [submitBtn1];
  if (sel.includes('input')) return [stakeInput1];
  return [];
};

(async () => {
  const result = await adapter.triggerPlaceBet(true, false, false, true, '25,00');
  assert.equal(result, true, 'triggerPlaceBet deve retornar true');
  assert.equal(stakeInput1.value, '25,00', 'Stake deve ser preenchida com 25,00');
  assert.equal(submitBtn1._clicked, true, 'Botão de submissão da Superbet deve ter sido clicado');
  console.log('  -> triggerPlaceBet fluxo completo (preenchimento + confirmação) 100% OK!');

  // 5. Testando selectOddsOnSuperbet no 2º Gol • Al Ain @ 2.30 (cenário real do usuário)
  console.log('[Test] 5. Testando selectOddsOnSuperbet no 2º Gol • Al Ain @ 2.30...');
  const oddBtnAlAin = createMockElement('button', {
    class: 'odd-button',
    id: 'btn-alain-2gol'
  }, '', [
    createMockElement('span', { class: 'odd-button__odd-name' }, 'Al Ain'),
    createMockElement('span', { class: 'odd-button__odd-value' }, '2.30')
  ]);
  const marketHeader2Gol = createMockElement('div', { class: 'market-header-base' }, '', [
    createMockElement('span', { class: 'market-header-base__name' }, '2º Gol')
  ]);
  const card2Gol = createMockElement('div', { class: 'single-market-card' }, '', [
    marketHeader2Gol,
    oddBtnAlAin
  ]);
  marketHeader2Gol.parentElement = card2Gol;
  oddBtnAlAin.parentElement = card2Gol;

  global.document.querySelectorAll = (sel) => {
    if (sel.includes('header')) return [marketHeader2Gol.children[0]];
    if (sel.includes('odd') || sel.includes('button')) return [oddBtnAlAin, submitBtn1];
    if (sel.includes('input')) return [stakeInput1];
    return [];
  };

  const outcomeAlAin = adapter.findOutcome('Al Ain', '2.30', null, '2º Gol');
  assert.equal(outcomeAlAin, oddBtnAlAin, 'Deve localizar o botão de Al Ain no card do 2º Gol');
  console.log('  -> findOutcome para 2º Gol • Al Ain @ 2.30 100% OK!');

  const selectResult = await adapter.selectOddsOnSuperbet('Al Ain', '2.30', '2º Gol', 0, 0, false, '', true, 'Al Ain', null, '10,00');
  assert.equal(selectResult, true, 'selectOddsOnSuperbet deve retornar true');
  assert.equal(oddBtnAlAin._clicked, true, 'Botão Al Ain 2.30 deve ter sido clicado');
  assert.equal(stakeInput1.value, '10,00', 'Stake deve ser atualizada para 10,00');
  console.log('  -> selectOddsOnSuperbet fluxo completo 100% OK!');

  console.log('\n🎉 TODOS OS TESTES DE STAKE E CONFIRMAÇÃO DA SUPERBET PASSARAM COM SUCESSO!');
})();
