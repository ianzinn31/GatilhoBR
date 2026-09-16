// Pequeno carregador de compatibilidade para a dashboard empacotada.
// O frontend original é distribuído apenas como bundle; injetamos Betano na
// lista de casas antes de avaliá-lo, preservando o restante do código intacto.
const response = await fetch("./assets/index-bBFKOU_L.js");
let source = await response.text();
const marker = "{id:`betmgm`,name:`BetMGM`,shortName:`MGM`,logoUrl:`./betmgm-logo.png`}";
const betano = "{id:`betano`,name:`Betano`,shortName:`BTN`,logoUrl:`./betano-logo.png`}";
if (!source.includes(betano) && source.includes(marker)) {
  source = source.replace(marker, `${marker},${betano}`);
}

// O bundle também possui tabelas internas de roteamento e normalização. Sem estes
// patches, a lista visual mostra Betano, mas os snapshots caem na casa padrão (Bet365).
const replacements = [
  // 1. Dicionário de nomes de exibição por casa
  ["betfair:`Betfair`,betnacional:`Betnacional`,betmgm:`BetMGM`,", "betano:`Betano`,betfair:`Betfair`,betnacional:`Betnacional`,betmgm:`BetMGM`,"],
  // 2. Estado inicial de conexões
  ["betmgmActive:!1,superbetActive:!1", "betmgmActive:!1,betanoActive:!1,superbetActive:!1"],
  // 3. Padrões de URL para detecção de abas de trading
  ["*://superbet.bet.br/*`,`*://*.superbet.bet.br/*`],Lx", "*://superbet.bet.br/*`,`*://*.superbet.bet.br/*`,`*://betano.bet.br/*`,`*://*.betano.bet.br/*`],Lx"],
  // 4. Normalização de stake configurada por casa
  ["[`bet365`,`betfair`,`betnacional`,`betmgm`,`superbet`]){let r=zx(t[e])", "[`bet365`,`betfair`,`betnacional`,`betmgm`,`superbet`,`betano`]){let r=zx(t[e])"],
  // 5. Resolução da casa no snapshot pelo siteName (Hx)
  ["t.includes(`betmgm`)?`betmgm`:t.includes(`superbet`)?`superbet`:`bet365`", "t.includes(`betmgm`)?`betmgm`:t.includes(`betano`)?`betano`:t.includes(`superbet`)?`superbet`:`bet365`"],
  // 6. Atualização de status ao receber evento de conexão
  ["betmgmActive:!!t.betmgmActive,superbetActive:!!t.superbetActive", "betmgmActive:!!t.betmgmActive,betanoActive:!!t.betanoActive,superbetActive:!!t.superbetActive"],
  // 7. Handshake inicial de solicitação de mercados
  ["house:`betmgm`}),Ax.postMessage({type:`REQUEST_MARKETS`,house:`superbet`", "house:`betmgm`}),Ax.postMessage({type:`REQUEST_MARKETS`,house:`betano`}),Ax.postMessage({type:`REQUEST_MARKETS`,house:`superbet`"],
  // 8. Consulta se a casa está ativa
  ["e===`betmgm`?Nx.betmgmActive:Nx.superbetActive", "e===`betmgm`?Nx.betmgmActive:e===`betano`?Nx.betanoActive:Nx.superbetActive"],
  // 9. Mapeamento de status de conexão na lista de casas
  ["[`bet365`,`betfair`,`betnacional`,`betmgm`,`superbet`].map(t=>({house:t", "[`bet365`,`betfair`,`betnacional`,`betmgm`,`betano`,`superbet`].map(t=>({house:t"],
  // 10. Normalização de binds para a casa correta
  [":t.house===`betmgm`?`betmgm`:t.house===`superbet`?`superbet`:`bet365`", ":t.house===`betmgm`?`betmgm`:t.house===`betano`?`betano`:t.house===`superbet`?`superbet`:`bet365`"],
  // 11. Lista unificada de favoritos / mercados prioritários
  [",...s?.betmgm??[],...s?.superbet??[]]", ",...s?.betmgm??[],...s?.betano??[],...s?.superbet??[]]"],
  // 12. Obtenção de mercados getMarkets
  ["e?[e]:[`bet365`,`betfair`,`betnacional`,`betmgm`,`superbet`]),await eS()", "e?[e]:[`bet365`,`betfair`,`betnacional`,`betmgm`,`betano`,`superbet`]),await eS()"],
  // 13. Sincronização de mercados syncMarkets
  ["e?[e]:[`bet365`,`betfair`,`betnacional`,`betmgm`,`superbet`];if(!Dx)", "e?[e]:[`bet365`,`betfair`,`betnacional`,`betmgm`,`betano`,`superbet`];if(!Dx)"],
  // 14. Favoritos por casa
  ["betmgm:t(`betmgm`),superbet:t(`superbet`)", "betmgm:t(`betmgm`),betano:t(`betano`),superbet:t(`superbet`)"],
  // 15. Fallbacks de saldo
  ["n.betmgm??n.superbet", "n.betmgm??n.betano??n.superbet"],
  // 16. Fallbacks de cotação
  ["t.betmgm??t.superbet", "t.betmgm??t.betano??t.superbet"],
  // 17. Régua de seleção de casas na página de Mercados ao Vivo (apenas alternância de visualização de mercados)
  [
    "actions:(0,B.jsx)(aA,{selectedHouse:n,onSelectHouse:e=>r.selectHouse(e)})}),i?(0,B.jsx)(_T,{event:i,connection:a}):null",
    "actions:null}),(0,B.jsx)(`div`,{className:`gbr-markets-house-bar w-full`,children:(0,B.jsx)(aA,{selectedHouse:n,onSelectHouse:e=>r.selectHouse(e)})}),i?(0,B.jsx)(_T,{event:i,connection:a}):null"
  ],
  // 18. Previne siglas feias duplicadas caso fallback de imagem dispare (ex: 'BTN Betano')
  [
    "n&&(n.style.display=`inline`)}}),(0,B.jsx)(`span`,{className:`hidden text-[11px] font-bold tracking-wider text-muted-foreground`,children:n.shortName})",
    "n&&(n.style.display=`none`)}}),(0,B.jsx)(`span`,{className:`hidden`,children:``})"
  ],
  // 19. Seção 'Casas de Aposta' EXCLUSIVA na Dashboard inicial com botões individuais 'Abrir Casa'
  [
    "(0,B.jsxs)(`section`,{className:`rounded-lg border border-border bg-card p-3`,children:[(0,B.jsx)(`h2`,{className:`text-xs font-semibold uppercase tracking-wide text-muted-foreground`,children:`Conexões`}),(0,B.jsx)(`div`,{className:`mt-2 flex flex-wrap gap-2`,children:e.map(e=>(0,B.jsx)(Ey,{status:e,showBalance:!0},e.house))})]})",
    "(0,B.jsxs)(`section`,{className:`gbr-dashboard-houses-section rounded-xl border border-primary/25 bg-card/90 p-4 shadow-lg backdrop-blur-md space-y-3`,children:[(0,B.jsxs)(`div`,{className:`flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3`,children:[(0,B.jsxs)(`div`,{children:[(0,B.jsxs)(`h2`,{className:`text-sm font-bold tracking-tight text-foreground flex items-center gap-2`,children:[(0,B.jsx)(`span`,{className:`size-2 rounded-full bg-primary animate-pulse`}),`Casas de Aposta`]}),(0,B.jsx)(`p`,{className:`text-xs text-muted-foreground mt-0.5`,children:`Abra as casas de aposta individualmente para iniciar suas operações`})]}),(0,B.jsx)(`button`,{type:`button`,\"data-house\":`all`,onClick:(ev)=>{ev.stopPropagation();if(typeof window!==`undefined`&&window.__gbrElectronApi){window.__gbrElectronApi.send(`gbr:open-house`,{house:`all`})}},title:`Abrir todas as casas configuradas (F9)`,className:`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-primary bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-all cursor-pointer shadow-sm`,children:`⚡ Abrir Todas (F9)`})]}),(0,B.jsx)(`div`,{className:`grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 pt-1`,children:e.map(t=>(0,B.jsxs)(`div`,{key:t.house,\"data-house\":t.house,onClick:(ev)=>{ev.stopPropagation();if(typeof window!==`undefined`&&window.__gbrElectronApi){window.__gbrElectronApi.send(`gbr:open-house`,{house:t.house})}},className:`gbr-house-card flex flex-col justify-between p-3 rounded-xl border border-white/10 bg-surface/90 hover:border-primary/50 hover:bg-surface/95 transition-all cursor-pointer shadow-sm group select-none`,children:[(0,B.jsxs)(`div`,{className:`flex items-center justify-between gap-2 mb-2`,children:[(0,B.jsxs)(`div`,{className:`flex items-center gap-2`,children:[(0,B.jsx)(`img`,{src:`./\${t.house}-logo.png`,alt:vy[t.house]||t.house,className:`h-4 w-auto max-w-[40px] object-contain`,onError:ev=>{ev.currentTarget.style.display=\`none\`}}),(0,B.jsx)(`span`,{className:`font-bold text-xs text-foreground group-hover:text-primary transition-colors`,children:vy[t.house]||t.house})]}),(0,B.jsx)(`span`,{className:q(`size-2 rounded-full`,t.state===\`connected\`?\`bg-ok animate-pulse\`:\`bg-muted-foreground/40\`)})]}),(0,B.jsxs)(`div`,{className:`flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-xs`,children:[(0,B.jsx)(`span`,{className:`text-muted-foreground font-mono tabular text-[11px]`,children:t.balance!==void 0?Z(t.balance):\`--\`}),(0,B.jsxs)(`span`,{className:`inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 group-hover:bg-primary group-hover:text-black px-2 py-0.5 rounded-md transition-all cursor-pointer`,children:[\`Abrir\`,(0,B.jsx)(`span`,{children:\`↗\`})]})]})]}))})]})"
  ],
  // 20. Autoridade de stake no clique do painel (SELECT_ODDS_ACTION)
  [
    "BS({type:`SELECT_ODDS_ACTION`,house:e.house,fastMode:!0,...zS(`select_odds`),payload:{house:e.house,eventId:e.eventId,name:e.source.targetName,lineName:e.source.lineName,optionLabel:e.source.optionLabel,odds:e.source.originalOdds||String(e.odds),marketTitle:e.source.marketTitle,colIndex:e.columnIndex,rowIndex:e.rowIndex,outcomeId:e.source.outcomeId}})",
    "BS({type:`SELECT_ODDS_ACTION`,house:e.house,fastMode:!0,stake:t,stakeVal:typeof t===`number`?t.toFixed(2):String(t||``),...zS(`select_odds`),payload:{house:e.house,eventId:e.eventId,name:e.source.targetName,lineName:e.source.lineName,optionLabel:e.source.optionLabel,odds:e.source.originalOdds||String(e.odds),marketTitle:e.source.marketTitle,colIndex:e.columnIndex,rowIndex:e.rowIndex,outcomeId:e.source.outcomeId,stake:t,stakeVal:typeof t===`number`?t.toFixed(2):String(t||``)}})"
  ],
  // 21. Transmissão de stake na execução de bind (DYNAMIC_BIND_ACTION)
  [
    "BS({type:`DYNAMIC_BIND_ACTION`,house:e.houseId,keyCode:n,binds:NS(e),...t})",
    "BS({type:`DYNAMIC_BIND_ACTION`,house:e.houseId,keyCode:n,stake:e.stake,stakeVal:typeof e.stake===`number`?e.stake.toFixed(2):void 0,binds:NS(e),...t})"
  ],
  // 22. Transmissão direta de UPDATE_CONFIG para livePort e runtime.sendMessage
  [
    "action:`UPDATE_CONFIG`,config:{stakeVal:e.toFixed(2),stakeValByHouse:t,oneShot:n,oneClick:n,oddsChangePolicy:r,executionMode:i,directOrderAutoSelection:a,directOrderMaxStake:o,autoAcceptOddsBool:r!==`reject_changes`}};await Promise.allSettled",
    "action:`UPDATE_CONFIG`,config:{stakeVal:e.toFixed(2),stakeValByHouse:t,oneShot:n,oneClick:n,oddsChangePolicy:r,executionMode:i,directOrderAutoSelection:a,directOrderMaxStake:o,autoAcceptOddsBool:r!==`reject_changes`}};try{BS(c)}catch(_){}try{Ex?.runtime?.sendMessage?.(c)}catch(_){}try{window.__gbrElectronApi?.send?.(`gbr:update-config`,c)}catch(_){}await Promise.allSettled"
  ]
];

for (const [from, to] of replacements) {
  if (source.includes(from)) {
    source = source.replace(from, to);
  }
}

// Avaliação no contexto do módulo mantém as APIs globais e o bootstrap React.
const run = (0, eval);
run(`${source}\n//# sourceURL=dashboard-bundle.js`);
