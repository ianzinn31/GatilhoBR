// =========================================================================
// FAST TRIGGER PRO - SCRAPER DE MERCADOS HORIZONTAIS DE JOGADORES (SIP-)
// =========================================================================

// Identidade de rede da célula, quando o resolvedor conseguir provar qual é.
// Leitura apenas: raspar não é acionar, então aqui NÃO há depósito — depositar a
// cada célula raspada faria a última varrida sobrescrever a seleção real do
// cupom. O depósito acontece no clique/foco da célula.
function resolveGridSelectionId(element, odds) {
  const resolver = typeof window !== 'undefined' ? window.FastTriggerSelectionResolver : null;
  if (!resolver || typeof resolver.resolve !== 'function') return null;
  try {
    const parsed = Number(String(odds || '').replace(',', '.'));
    return resolver.resolve(element, {
      odds: Number.isFinite(parsed) && parsed > 1 ? parsed : undefined,
    });
  } catch (error) {
    return null;
  }
}

function scrapeHorizontalPlayerMarkets() {
  // Busca todas as linhas de jogadores (suporte a seletores dinâmicos wildcard)
  const rows = Array.from(document.querySelectorAll(
    '.sip-MarketLabelForSingleRow, [class*="MarketLabelForSingleRow"]'
  ));

  if (rows.length === 0) return [];

  return rows.map(row => {
    // 1. Captura o nome do jogador e estatística atual (ex: "Guilherme Augusto 1")
    const headerNode = row.querySelector('.sip-MarketColumnHeaderWithCount, [class*="MarketColumnHeaderWithCount"]');
    const fullHeaderText = headerNode ? headerNode.innerText.trim().replace(/\s+/g, ' ') : '';

    // Separa o nome do jogador da contagem atual
    const playerMatch = fullHeaderText.match(/^(.*?)(?:\s+(\d+))?$/);
    const playerName = playerMatch ? playerMatch[1].trim() : fullHeaderText;
    const currentCount = playerMatch && playerMatch[2] ? playerMatch[2] : '0';

    // 2. Extrai todas as opções de odds dispostas horizontalmente na linha
    const options = Array.from(row.querySelectorAll(
      '.sip-SingleMarketScrollerParticipant, [class*="SingleMarketScrollerParticipant"][class*="Participant_General"]'
    )).map(option => {
      const lineLabel = option.querySelector('.sip-SingleMarketScrollerParticipant_Name, [class*="ScrollerParticipant_Name"]')?.innerText.trim();
      const oddsValue = option.querySelector('.sip-SingleMarketScrollerParticipant_Odds, [class*="ScrollerParticipant_Odds"]')?.innerText.trim();

      const resolved = resolveGridSelectionId(option, oddsValue);

      return {
        line: lineLabel, // ex: "1+", "2+", "3+"
        odds: oddsValue, // ex: "6.50"
        selectionId: resolved?.selectionId || null, // id de rede, quando inequívoco
        marketId: resolved?.marketId || null,
        selectionSource: resolved?.source || null,
        element: option  // Referência do DOM para clique direto
      };
    }).filter(opt => opt.line && opt.odds && !isNaN(parseFloat(opt.odds)));

    return {
      player: playerName,
      currentStats: currentCount,
      selections: options
    };
  });
}

if (typeof window !== 'undefined') {
  window.scrapeHorizontalPlayerMarkets = scrapeHorizontalPlayerMarkets;
}
