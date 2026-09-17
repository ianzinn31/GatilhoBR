// =========================================================================
// FAST TRIGGER PRO - MOTOR DE PRESETS (GATILHO RÁPIDO DE JOGADOR/MERCADO)
// =========================================================================

/**
 * Busca e dispara uma aposta em um jogador/mercado específico na tela
 * @param {string} playerName Ex: "Neymar" ou "Marcinho Antonio"
 * @param {string} marketName Ex: "Chutes ao Gol" ou "Para Receber Cartão"
 * @param {number} optionIndex Índice da odd (0 = 1+, 1 = 2+, etc.)
 */
async function triggerPresetBet(playerName, marketName, optionIndex = 0) {
  try {
    console.log(`[Fast Trigger Preset] 🔍 Buscando: ${playerName} -> ${marketName}`);

    // 1. Localiza todos os nós de texto que contêm o nome do jogador na página
    const allElements = Array.from(document.querySelectorAll('*'));
    const playerNodes = allElements.filter(el => {
      const txt = el.innerText || el.textContent;
      return (
        txt &&
        txt.toLowerCase().includes(playerName.toLowerCase()) &&
        el.children.length === 0 && // Apenas nós folha (para não pegar wrappers gigantes)
        el.offsetWidth > 0 // Visível na tela
      );
    });

    if (playerNodes.length === 0) {
      console.warn(`[Fast Trigger Preset] ⚠️ Jogador "${playerName}" não encontrado na tela!`);
      return false;
    }

    // 2. Pega o primeiro nó válido e encontra a linha de odds associada
    const targetPlayerNode = playerNodes[0];
    
    // Sobe no DOM até achar o container da linha do participante (Row / Grid)
    const rowContainer = targetPlayerNode.closest(
      '[class*="ParticipantRow"], [class*="MarketGrid"], [class*="ParticipantContainer"], [class*="gl-Participant"], tr, div'
    );

    if (!rowContainer) {
      console.warn('[Fast Trigger Preset] ⚠️ Container da linha do jogador não localizado.');
      return false;
    }

    // 3. Busca os botões de odd dentro do mesmo bloco ou bloco adjacente
    const oddButtons = Array.from(rowContainer.querySelectorAll(
      '.gl-Participant, [class*="ParticipantButton"], [class*="Odds"], [class*="Participant"]'
    )).filter(btn => btn.offsetWidth > 0 && !isNaN(parseFloat(btn.innerText)));

    // Seleciona a odd de acordo com o índice (ex: 0 para o primeiro mercado/coluna)
    const targetOddBtn = oddButtons[optionIndex] || oddButtons[0];

    if (!targetOddBtn) {
      console.warn('[Fast Trigger Preset] ⚠️ Botão de odd não encontrado para este participante.');
      return false;
    }

    // 4. EXECUÇÃO EM CADEIA (Clique na Odd -> Stake -> Disparo)
    console.log(`[Fast Trigger Preset] 🎯 Odd encontrada (${targetOddBtn.innerText.trim()})! Clicando...`);
    
    // Clica na odd
    // Depósito do `selectionId` antes do clique: mesma regra do motor de gatilho.
    try {
      window.FastTriggerSelectionResolver?.deposit?.(targetOddBtn);
    } catch (err) {}
    targetOddBtn.click();

    // Injeta a Stake Gen5
    const stakeToFill =
      window.FastTriggerExpectedExecutionStake ||
      window.FastTriggerConfig?.stakeValByHouse?.bet365 ||
      window.FastTriggerConfig?.stakeVal ||
      '0.50';
    const filled = typeof pollAndFillStake === 'function' 
      ? await pollAndFillStake(10)
      : (typeof fillBet365StakeGen5 === 'function' ? await fillBet365StakeGen5(stakeToFill) : true);

    // Se o Disparo Direto estiver ativado ou for um preset de emergência, clica em Fazer Aposta
    if (filled) {
      await new Promise(r => setTimeout(r, 40));
      if (typeof triggerPlaceBet === 'function') {
        const confirmed = await triggerPlaceBet();
        if (!confirmed) {
          console.warn('[Fast Trigger Preset] Confirmacao nao reconhecida pelo cupom.');
          return false;
        }
      }
      console.log('[Fast Trigger Preset] 🚀 APOSTA DISPARADA EM VELOCIDADE MÁXIMA!');
      return true;
    }

    return false;

  } catch (err) {
    console.error('[Fast Trigger Preset] Erro na execução do preset:', err);
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.triggerPresetBet = triggerPresetBet;
}
