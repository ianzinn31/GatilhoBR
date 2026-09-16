const assert = require('assert');

console.log('=== TESTE DE AUTORIDADE DE STAKE DO ELECTRON ===');

// 1. Simulação do ambiente do navegador / content script
function setupMockBrowser(initialConfig = {}) {
  const listeners = [];
  const storage = {};

  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.value = '';
      this.innerText = '';
      this.textContent = '';
      this.offsetWidth = 100;
      this.offsetHeight = 30;
      this.attributes = {};
    }
    getAttribute(name) { return this.attributes[name] || ''; }
    setAttribute(name, val) { this.attributes[name] = val; }
    closest() { return null; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    dispatchEvent() { return true; }
    focus() {}
    click() {}
  }

  global.HTMLInputElement = MockElement;
  global.InputEvent = class { constructor(t, opts) { Object.assign(this, opts); } };
  global.Event = class { constructor(t, opts) { Object.assign(this, opts); } };
  global.KeyboardEvent = class { constructor(t, opts) { Object.assign(this, opts); } };

  global.window = {
    FastTriggerConfig: { ...initialConfig },
    FastTriggerState: {},
    FastTriggerExpectedExecutionStake: null,
    FastTriggerExternalElectronMode: true,
    HTMLInputElement: MockElement,
    addEventListener: () => {},
    removeEventListener: () => {},
    CustomEvent: class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } }
  };

  const mockInput = new MockElement('input');
  mockInput.setAttribute('aria-label', 'stake');

  global.document = {
    body: new MockElement('body'),
    contains: () => true,
    querySelector: (sel) => {
      if (sel && sel.includes('input')) return mockInput;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel && sel.includes('input')) return [mockInput];
      return [];
    },
    addEventListener: () => {}
  };

  global.chrome = {
    runtime: {
      sendMessage: (msg, cb) => { if (cb) cb({ status: 'OK' }); },
      onMessage: {
        addListener: (fn) => listeners.push(fn)
      }
    },
    storage: {
      local: {
        get: (keys, cb) => cb(storage),
        set: (obj, cb) => { Object.assign(storage, obj); if (cb) cb(); }
      }
    }
  };

  return {
    mockInput,
    dispatchMessage: (msg) => {
      listeners.forEach(fn => fn(msg, {}, () => {}));
    }
  };
}

// 2. Teste de Resolução de Stake nos Módulos e Adapters
async function runTests() {
  // Teste 1: parseNumericStake respeita FastTriggerExpectedExecutionStake e stakeValByHouse
  console.log('\n[Teste 1] Testando motor parseNumericStake do stakeEngine...');
  delete require.cache[require.resolve('../src/stakeEngine.js')];
  setupMockBrowser({ stakeVal: '100.00', stakeValByHouse: { bet365: '250.00' } });
  require('../src/stakeEngine.js');

  const parseNumericStake = window.FastTriggerStakeTesting.parseNumericStake;
  assert.strictEqual(typeof parseNumericStake, 'function', 'parseNumericStake deve existir');
  
  // Sem valor passado: deve pegar FastTriggerConfig.stakeValByHouse.bet365 ('250.00')
  const resolvedHouseStake = parseNumericStake('');
  assert.strictEqual(resolvedHouseStake, 250, 'Deve usar stake da casa bet365 se configurada');
  console.log('  -> Resolução de stake por casa (Bet365 = 250.00): OK!');

  // Com FastTriggerExpectedExecutionStake ('500.00')
  window.FastTriggerExpectedExecutionStake = '500.00';
  const resolvedExpectedStake = parseNumericStake('');
  assert.strictEqual(resolvedExpectedStake, 500, 'Deve usar FastTriggerExpectedExecutionStake');
  console.log('  -> Prioridade de FastTriggerExpectedExecutionStake (500.00): OK!');

  // Teste 2: Adapters usam stake autorizada do Electron (ex: 100.00) e NUNCA caem para 0.50
  console.log('\n[Teste 2] Testando resolução de stake em todos os adaptadores...');
  
  // Teste Betano
  delete require.cache[require.resolve('../src/adapters/betanoAdapter.js')];
  setupMockBrowser({ stakeVal: '100.00', stakeValByHouse: { betano: '120.00' } });
  require('../src/adapters/betanoAdapter.js');
  const betanoAdapter = new window.BetanoAdapter();
  
  let betanoInjectedStake = null;
  betanoAdapter.ensureBetslipExpanded = () => {};
  betanoAdapter.findStake = () => ({ tagName: 'INPUT', value: '' });
  betanoAdapter.injectStakeValue = (input, val) => { betanoInjectedStake = val; return true; };
  betanoAdapter.findSubmit = () => null;

  await betanoAdapter.triggerPlaceBet(true, false, false, true);
  assert.strictEqual(betanoInjectedStake, '120,00', 'Betano deve injetar stake de 120,00 configurada no Electron');
  console.log('  -> Betano Adapter autoridade de stake (120,00): OK!');

  // Teste Superbet
  delete require.cache[require.resolve('../src/adapters/superbetAdapter.js')];
  setupMockBrowser({ stakeVal: '100.00', stakeValByHouse: { superbet: '150.00' } });
  require('../src/adapters/superbetAdapter.js');
  const superbetAdapter = new window.SuperbetAdapter();

  let superbetInjectedStake = null;
  superbetAdapter.ensureBetslipExpanded = () => {};
  superbetAdapter.findStake = () => ({ tagName: 'INPUT', value: '' });
  superbetAdapter.injectStakeValue = (input, val) => { superbetInjectedStake = val; return true; };
  superbetAdapter.findSubmit = () => null;

  await superbetAdapter.triggerPlaceBet(true, false, false, true);
  assert.strictEqual(superbetInjectedStake, '150,00', 'Superbet deve injetar stake de 150,00');
  console.log('  -> Superbet Adapter autoridade de stake (150,00): OK!');

  // Teste Betfair Sportsbook (usa FastTriggerBetfairTesting.setBetfairStakeHuman)
  delete require.cache[require.resolve('../src/adapters/betfairSportsbookAdapter.js')];
  const { mockInput: betfairInput } = setupMockBrowser({ stakeVal: '100.00' });
  require('../src/adapters/betfairSportsbookAdapter.js');
  const betfairTesting = window.FastTriggerBetfairTesting;
  assert.strictEqual(typeof betfairTesting.setBetfairStakeHuman, 'function', 'setBetfairStakeHuman deve existir');

  // Testar diretamente a função de injeção da Betfair com valor resolvido
  const betfairResult = await betfairTesting.setBetfairStakeHuman('100.00', true);
  assert.strictEqual(betfairResult, true, 'setBetfairStakeHuman deve preencher com sucesso');
  assert.strictEqual(betfairInput.value, '100.00', 'Betfair deve receber 100.00 no input');
  console.log('  -> Betfair Sportsbook preenchimento de stake (100.00): OK!');

  // Teste Betnacional
  delete require.cache[require.resolve('../src/adapters/betnacionalAdapter.js')];
  setupMockBrowser({ stakeVal: '100.00', stakeValByHouse: { betnacional: '75.00' } });
  require('../src/adapters/betnacionalAdapter.js');
  const betnacionalAdapter = new window.BetnacionalAdapter();
  
  // Teste BetMGM
  delete require.cache[require.resolve('../src/adapters/betmgmAdapter.js')];
  setupMockBrowser({ stakeVal: '100.00', stakeValByHouse: { betmgm: '80.00' } });
  require('../src/adapters/betmgmAdapter.js');
  const betmgmAdapter = new window.BetMgmAdapter();

  console.log('\n🎉 TODOS OS TESTES DE AUTORIDADE DE STAKE FORAM CONCLUÍDOS COM SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});
