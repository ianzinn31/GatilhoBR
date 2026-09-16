document.addEventListener('DOMContentLoaded', () => {
  const bookmakerSelect = document.getElementById('bookmakerSelect');
  const customSelectorGroup = document.getElementById('customSelectorGroup');
  const customSelector = document.getElementById('customSelector');
  const triggerKey = document.getElementById('triggerKey');
  const defaultStake = document.getElementById('defaultStake');
  const autoFillStake = document.getElementById('autoFillStake');
  const targetMarket = document.getElementById('targetMarket');
  const autoAcceptOdds = document.getElementById('autoAcceptOdds');
  const showFloatingBtn = document.getElementById('showFloatingBtn');
  const btnSave = document.getElementById('btnSave');
  const btnReset = document.getElementById('btnReset');
  const toast = document.getElementById('toast');

  // Alterna exibição do campo de seletor customizado
  bookmakerSelect.addEventListener('change', () => {
    customSelectorGroup.style.display = (bookmakerSelect.value === 'custom') ? 'block' : 'none';
  });

  function showToast(msg) {
    toast.textContent = msg || '✅ Configurações Salvas com Sucesso!';
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // Carrega as configurações salvas
  function loadSettings() {
    const defaults = {
      bookmaker: 'auto',
      customSelectorStr: '',
      triggerKeyStr: 'Space',
      stakeVal: '50',
      autoFillStakeBool: true,
      targetMarketStr: 'any',
      autoAcceptOddsBool: true,
      showFloatingBtnBool: true
    };
    const scoped = window.gbrUserScopedStorage;
    if (!scoped) return;
    scoped.get('sync', defaults).then((data) => {
      bookmakerSelect.value = data.bookmaker;
      customSelectorGroup.style.display = (data.bookmaker === 'custom') ? 'block' : 'none';
      customSelector.value = data.customSelectorStr;
      triggerKey.value = data.triggerKeyStr;
      defaultStake.value = data.stakeVal;
      autoFillStake.checked = data.autoFillStakeBool;
      targetMarket.value = data.targetMarketStr;
      autoAcceptOdds.checked = data.autoAcceptOddsBool;
      showFloatingBtn.checked = data.showFloatingBtnBool;
    }).catch(() => {});
  }

  // Salva as configurações
  btnSave.addEventListener('click', () => {
    const config = {
      bookmaker: bookmakerSelect.value,
      customSelectorStr: customSelector.value.trim(),
      triggerKeyStr: triggerKey.value,
      stakeVal: defaultStake.value,
      autoFillStakeBool: autoFillStake.checked,
      targetMarketStr: targetMarket.value,
      autoAcceptOddsBool: autoAcceptOdds.checked,
      showFloatingBtnBool: showFloatingBtn.checked
    };

    const scoped = window.gbrUserScopedStorage;
    if (!scoped) return;
    scoped.set('sync', config).then(() => {
      showToast('✅ Configurações Salvas com Sucesso!');

      // Notifica abas ativas sobre a mudança de configuração
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'UPDATE_CONFIG', config: config }).catch(() => {});
          }
        });
      });
    }).catch(() => {});
  });

  // Restaurar padrões
  btnReset.addEventListener('click', () => {
    const scoped = window.gbrUserScopedStorage;
    if (!scoped) return;
    scoped.remove('sync', [
      'bookmaker',
      'customSelectorStr',
      'triggerKeyStr',
      'stakeVal',
      'autoFillStakeBool',
      'targetMarketStr',
      'autoAcceptOddsBool',
      'showFloatingBtnBool',
    ]).then(() => {
      loadSettings();
      showToast('🔄 Configurações Restauradas!');
    }).catch(() => {});
  });

  loadSettings();
});
