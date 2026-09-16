const assert = require('assert');
const BetanoAdapter = require('../src/adapters/betanoAdapter');

console.log('[Test Stake & Submit] 🚀 Iniciando testes de preenchimento e confirmação instantânea da Betano...');

// Mock global básico para simulação DOM
global.window = {
  HTMLInputElement: function() {},
  FastTriggerConfig: { stakeVal: '10.00', oneClick: true, oneShot: true },
  FastTriggerState: { electronAuthorizedUntil: Date.now() + 60000, selectionPermit: { actionId: 'test-123' } }
};
global.window.HTMLInputElement.prototype = {};
let mockInputValue = '';
Object.defineProperty(global.window.HTMLInputElement.prototype, 'value', {
  get() { return mockInputValue; },
  set(v) { mockInputValue = v; },
  configurable: true
});

function createEl(tag, attrs = {}, text = '', children = []) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    textContent: text,
    innerText: text,
    get value() { return mockInputValue; },
    set value(v) { mockInputValue = v; },
    disabled: attrs.disabled === true,
    readOnly: attrs.readOnly === true,
    isConnected: true,
    offsetParent: {},
    attributes: attrs,
    style: {},
    children,
    getAttribute(name) { return attrs[name] !== undefined ? attrs[name] : null; },
    setAttribute(name, val) { attrs[name] = val; },
    focus() { this.focused = true; },
    blur() { this.focused = false; },
    click() { this.clicked = true; },
    select() { this.selected = true; },
    dispatchEvent(evt) {
      if (evt && evt.type) {
        (listeners[evt.type] || []).forEach(fn => fn(evt));
      }
      return true;
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    querySelector(sel) {
      const q = sel.toLowerCase();
      for (const c of this.children) {
        if (match(c, q)) return c;
        const sub = c.querySelector?.(sel);
        if (sub) return sub;
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      const q = sel.toLowerCase();
      const traverse = (node) => {
        for (const c of (node.children || [])) {
          if (match(c, q)) results.push(c);
          traverse(c);
        }
      };
      traverse(this);
      return results;
    }
  };
}

function match(el, q) {
  if (!el || !el.getAttribute) return false;
  if (q.includes('input') && el.tagName === 'INPUT') return true;
  if (q.includes('button') && el.tagName === 'BUTTON') return true;
  if (q.includes('#right-sidebar') && el.getAttribute('id') === 'right-sidebar') return true;
  if (q.includes('betslip-stake-input') && el.getAttribute('data-qa') === 'betslip-stake-input') return true;
  if (q.includes('betslip-place-bet-button') && el.getAttribute('data-qa') === 'betslip-place-bet-button') return true;
  return false;
}

const adapter = new BetanoAdapter();

// 1. Testar findStake com escopos diversos
console.log('[Test] 1. Testando busca de input de Stake...');
const stakeInputDirect = createEl('input', { 'data-qa': 'betslip-stake-input', inputmode: 'decimal', placeholder: '0,00' });
const betslipContainer = createEl('aside', { id: 'right-sidebar' }, '', [stakeInputDirect]);

global.document = {
  querySelector(sel) {
    if (sel.includes('betslip-stake-input')) return stakeInputDirect;
    if (sel === '#right-sidebar') return betslipContainer;
    return null;
  },
  querySelectorAll() { return [stakeInputDirect]; }
};

const foundStake = adapter.findStake(betslipContainer);
assert(foundStake, 'findStake deve retornar o input de stake');
assert.strictEqual(foundStake, stakeInputDirect);
console.log('  -> findStake 100% OK!');

// 2. Testar injeção de stake
console.log('[Test] 2. Testando injectStakeValue...');
const testInput = createEl('input', { type: 'text' });
let inputFired = false;
let changeFired = false;
testInput.addEventListener('input', () => { inputFired = true; });
testInput.addEventListener('change', () => { changeFired = true; });

const injected = adapter.injectStakeValue(testInput, '5,00');
assert(injected, 'injectStakeValue deve retornar true');
assert.strictEqual(mockInputValue, '5,00', 'mockInputValue deve ser 5,00');
assert(inputFired, 'Evento input deve ter sido disparado');
assert(changeFired, 'Evento change deve ter sido disparado');
console.log('  -> injectStakeValue 100% OK!');

// 3. Testar findSubmit com diferentes textos da Betano
console.log('[Test] 3. Testando busca do botão de Aposta (Submit)...');
const labels = ['Apostar', 'Aposta', 'Aposte Já', 'Fazer Aposta', 'Confirmar', 'Aceitar e Apostar', 'Place Bet'];
for (const l of labels) {
  const submitBtn = createEl('button', { type: 'button' }, l);
  betslipContainer.children = [submitBtn];
  const found = adapter.findSubmit(betslipContainer);
  assert(found, `findSubmit deve encontrar botão com rótulo "${l}"`);
  assert.strictEqual(found, submitBtn);
}
console.log('  -> findSubmit 100% OK com todos os rótulos de aposta!');

// 3.1 Testar rejeição de botões auxiliares (Configurações, Lixeira, Salvar, Compartilhar)
console.log('[Test] 3.1 Testando rejeição estrita do botão de Configurações do cupom...');
const settingsBtn = createEl('button', { 'data-qa': 'betslip-settings-button', class: 'betslip-header-btn' }, '');
const trashBtn = createEl('button', { 'data-qa': 'betslip-clear-button', 'aria-label': 'Limpar cupom' }, '');
const saveBtn = createEl('button', { type: 'button' }, 'Salvar');
const shareBtn = createEl('button', { type: 'button' }, 'Compartilhar');
const realGreenCtaBtn = createEl('button', { 'data-qa': 'betslip-place-bet-button', class: 'betslip-bottom-cta' }, 'APOSTE JÁ R$0,50\nGanhos Potenciais R$0,58');

// Coloca os botões de header antes do botão de aposta (exatamente como no DOM real da Betano)
betslipContainer.children = [settingsBtn, trashBtn, saveBtn, shareBtn, realGreenCtaBtn];
const selectedSubmit = adapter.findSubmit(betslipContainer);
assert.notStrictEqual(selectedSubmit, settingsBtn, 'findSubmit NUNCA deve retornar o botão de configurações!');
assert.notStrictEqual(selectedSubmit, trashBtn, 'findSubmit NUNCA deve retornar o botão de lixeira/limpar!');
assert.notStrictEqual(selectedSubmit, saveBtn, 'findSubmit NUNCA deve retornar o botão salvar!');
assert.strictEqual(selectedSubmit, realGreenCtaBtn, 'findSubmit DEVE retornar o botão verde APOSTE JÁ!');
console.log('  -> Rejeição de botões de configurações/cabeçalho 100% OK! Apenas o botão APOSTE JÁ é selecionado!');

// 3.2 Testar botão verde real da Betano sem data-qa e com classes Tailwind (incluindo disabled:tw-opacity-50)
console.log('[Test] 3.2 Testando botão verde real da Betano sem data-qa e com classes Tailwind...');
const realTailwindBtn = createEl('button', {
  class: 'tw-w-full tw-py-3 tw-bg-primary-green tw-text-white tw-font-bold tw-rounded disabled:tw-opacity-50 disabled:tw-cursor-not-allowed'
}, 'APOSTE JÁ R$0,50\nGanhos Potenciais R$0,58');
betslipContainer.children = [settingsBtn, realTailwindBtn];
const foundTailwind = adapter.findSubmit(betslipContainer);
assert.strictEqual(foundTailwind, realTailwindBtn, 'findSubmit DEVE encontrar o botão verde real mesmo sem data-qa e com classes Tailwind!');
console.log('  -> Botão verde real com classes Tailwind 100% OK!');

// 3.3 Testar botão com aria-label contendo "Cupom"
console.log('[Test] 3.3 Testando botão com aria-label contendo "Cupom"...');
const ariaCupomBtn = createEl('button', {
  'aria-label': 'Cupom de apostas - APOSTE JÁ R$0,50',
  class: 'tw-bg-primary-green'
}, 'APOSTE JÁ R$0,50');
betslipContainer.children = [settingsBtn, ariaCupomBtn];
const foundCupom = adapter.findSubmit(betslipContainer);
assert.strictEqual(foundCupom, ariaCupomBtn, 'findSubmit DEVE aceitar botão com texto APOSTE JÁ mesmo com palavra "Cupom" no aria-label!');
console.log('  -> Botão com aria-label contendo Cupom 100% OK!');

// 4. Testar triggerPlaceBet completo com autorização Electron
console.log('[Test] 4. Testando fluxo completo triggerPlaceBet...');
const fullStakeInput = createEl('input', { 'data-qa': 'betslip-stake-input' });
const fullSubmitBtn = createEl('button', { 'data-qa': 'betslip-place-bet-button' }, 'Apostar');

global.document.querySelector = (sel) => {
  if (sel.includes('betslip-stake-input')) return fullStakeInput;
  if (sel.includes('betslip-place-bet-button')) return fullSubmitBtn;
  if (sel.includes('#right-sidebar')) return betslipContainer;
  return null;
};
global.document.querySelectorAll = () => [fullStakeInput, fullSubmitBtn];

adapter.triggerPlaceBet(false, false, false, true, '15.00').then((success) => {
  assert(success, 'triggerPlaceBet deve retornar true no modo fastDispatch com autorização');
  assert(fullSubmitBtn.clicked, 'fullSubmitBtn deve ter recebido o clique de confirmação');
  assert.strictEqual(mockInputValue, '15,00', 'Stake deve ter sido preenchida como 15,00');
  console.log('  -> triggerPlaceBet fluxo completo (preenchimento + confirmação) 100% OK!');
  console.log('\n🎉 TODOS OS TESTES DE STAKE E CONFIRMAÇÃO DA BETANO PASSARAM COM SUCESSO!');
});
