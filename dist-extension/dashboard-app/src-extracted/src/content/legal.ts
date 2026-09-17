export const TERMS_VERSION = "2026-07-31";
export const PRIVACY_VERSION = "2026-07-31";
export const LEGAL_EFFECTIVE_DATE = "31 de julho de 2026";

export type LegalDocumentKind = "terms" | "privacy";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export const legalDocuments: Record<
  LegalDocumentKind,
  { title: string; version: string; introduction: string; sections: LegalSection[] }
> = {
  terms: {
    title: "Termos de Uso",
    version: TERMS_VERSION,
    introduction:
      "Estes Termos regulam o acesso e o uso da plataforma e extensão GatilhoBR. Leia atentamente todo o documento antes de criar uma conta, contratar um plano ou utilizar qualquer funcionalidade do sistema.",
    sections: [
      {
        title: "1. Identificação e aceitação",
        paragraphs: [
          "O GatilhoBR é uma ferramenta de produtividade e apoio operacional para usuários de plataformas de apostas esportivas, disponibilizada pelo seu responsável legal e operacional, doravante denominado 'GatilhoBR'.",
          "Ao criar uma conta, marcar o aceite no cadastro ou utilizar o GatilhoBR, o usuário declara expressamente que leu, compreendeu e concorda de forma integral e irrestrita com estes Termos de Uso e com a Política de Privacidade. Caso não concorde com qualquer disposição, o usuário não deverá utilizar o serviço.",
        ],
      },
      {
        title: "2. Requisitos para uso",
        bullets: [
          "Ter idade igual ou superior a 18 (dezoito) anos, plena capacidade civil e permissão legal para apostar na sua jurisdição.",
          "Fornecer informações cadastrais verdadeiras, exatas, atuais e completas.",
          "Manter sob sua responsabilidade exclusiva a segurança de seus dispositivos, credenciais de acesso, senhas e configurações de binds/atalhos.",
          "Cumprir rigorosamente a legislação aplicável e os termos e regulamentos das casas de apostas utilizadas.",
        ],
      },
      {
        title: "3. Natureza do serviço e ausência total de garantia de resultados",
        paragraphs: [
          "O GatilhoBR é uma ferramenta tecnológica independente. O GatilhoBR NÃO é casa de apostas, instituição financeira, corretora, consultoria de investimentos ou serviço de dicas/palpites (tipster), nem possui qualquer vínculo ou representação oficial com Bet365, Betfair ou qualquer outra plataforma.",
          "O GATILHOBR NÃO GARANTE RESULTADOS, GANHOS, LUCROS, RENTABILIDADE, TAXA DE ACERTO OU QUALQUER RETORNO FINANCEIRO. O uso da plataforma é de inteira responsabilidade e risco do usuário. Informações, presets, estatísticas, alertas ou favoritos disponibilizados possuem caráter exclusivamente operacional e informativo e jamais constituem promessa ou garantia de resultado comercial ou esportivo.",
        ],
      },
      {
        title: "4. Comandos, binds, stake e isenção por apostas erradas e erros operacionais",
        paragraphs: [
          "Todo e qualquer comando acionado pelo GatilhoBR — incluindo seleções de odds, cálculo/preenchimento de stake, atalhos de teclado (binds), presets e envios para o cupom da casa — ocorre estritamente por iniciativa e comando direto do usuário.",
          "O GATILHOBR NÃO SE RESPONSABILIZA POR APOSTAS ERRADAS, SELEÇÕES INCORRETAS, ERROS DE CLIQUE, COMANDOS OU ATALHOS ACIONADOS POR ENGANO, STAKES DIVERGENTES, ODDS ALTERADAS NO MOMENTO DA EXECUÇÃO, ERROS DE PARSER/SOFTWARE, LATÊNCIA DE REDE OU FALHAS DE INTERFACE NAS CASAS DE APOSTAS.",
          "É de responsabilidade única e exclusiva do usuário conferir integralmente a partida, o mercado, a seleção, o jogador, a linha, a odd, o valor da stake e o estado do bilhete antes de efetuar ou confirmar qualquer aposta na casa parceira.",
        ],
      },
      {
        title: "5. Uso permitido e proibições",
        bullets: [
          "É terminantemente proibido utilizar o GatilhoBR para fins ilícitos, fraudes, lavagem de dinheiro, invasão ou uso de contas de terceiros, automação abusiva, manipulação de eventos ou qualquer ato ilegal.",
          "É proibido revender, ceder, sublicenciar, distribuir, engenhar reversamente, contornar travas de licença ou interferir na infraestrutura do GatilhoBR.",
          "É de responsabilidade do usuário verificar a conformidade do uso de ferramentas auxiliares junto às casas de apostas. O GatilhoBR não responde por eventuais limitações, suspensões de conta ou bloqueios impostos pelas casas de apostas aos usuários.",
        ],
      },
      {
        title: "6. Assinatura, pagamento e cancelamento",
        paragraphs: [
          "Os valores, planos, períodos e condições comerciais são apresentados no momento do checkout Pix. O acesso é liberado após a confirmação válida da transação pelos sistemas bancários integrados.",
          "Solicitações de cancelamento e reembolsos seguirão os critérios da oferta e os direitos irrenunciáveis previstos no Código de Defesa do Consumidor. Cupons promocionais possuem regras de aplicação e validade próprias especificadas no ato do uso.",
        ],
      },
      {
        title: "7. Disponibilidade, atualizações e serviços de terceiros",
        paragraphs: [
          "O GatilhoBR poderá passar por manutenções, atualizações ou modificações técnicas sem aviso prévio. Não garantimos disponibilidade ininterrupta, funcionamento livre de erros ou compatibilidade eterna com mudanças no layout ou regras de casas de apostas (Bet365, Betfair, etc.).",
          "Plataformas de terceiros operam de forma independente. Alterações promovidas por essas plataformas podem indisponibilizar funcionalidades da extensão sem que isso gere dever de indenizar por parte do GatilhoBR.",
        ],
      },
      {
        title: "8. Propriedade intelectual",
        paragraphs: [
          "Todos os direitos de propriedade intelectual sobre o software, marcas, código-fonte, interfaces e conteúdos do GatilhoBR pertencem exclusivamente à plataforma. O usuário recebe uma licença pessoal, revogável, não exclusiva e intransferível de uso durante a vigência de seu plano.",
        ],
      },
      {
        title: "9. Limitação integral de responsabilidade",
        paragraphs: [
          "NA MÁXIMA EXTENSÃO PERMITIDA PELA LEGISLAÇÃO APLICÁVEL, O GATILHOBR NÃO RESPONDERÁ POR PERDAS EM APOSTAS, PERDA DE BANCA, LUCROS CESSANTES, DIVERGÊNCIAS DE ODDS, APOSTAS NÃO EXECUTADAS OU EXECUTADAS DIVERGENTEMENTE, FALHAS DE INTERNET OU DISPOSITIVO, NEM POR DECISÕES TOMADAS PELAS CASAS DE APOSTAS OU DANOS DIRETOS OU INDIRETOS.",
          "Nenhuma cláusula destes Termos exclui responsabilidades estritamente irrenunciáveis sob a legislação brasileira imperativa de proteção ao consumidor.",
        ],
      },
      {
        title: "10. Jogo responsável",
        paragraphs: [
          "Apostas esportivas envolvem alto risco financeiro e jamais devem ser consideradas investimentos. O usuário deve estabelecer limites de valor e tempo, não apostar valores destinados a necessidades básicas e buscar auxílio especializado caso identifique sinais de perda de controle ou compulsão.",
        ],
      },
      {
        title: "11. Suspensão, bloqueio e cancelamento da conta sem aviso prévio",
        paragraphs: [
          "O GATILHOBR POSSUI TOTAL LIBERDADE E PRERROGATIVA PARA CANCELAR, SUSPENDER, BLOQUEAR OU ENCERRAR O ACESSO À CONTA DO USUÁRIO OU À LICENÇA DO SOFTWARE A QUALQUER MOMENTO, COM OU SEM AVISO PRÉVIO.",
          "Tal medida poderá ser adotada em casos de violação destes Termos, uso indevido da plataforma, suspeita de fraude, incompatibilidade técnica, motivos de segurança, inadimplência ou por critérios operacionais e comerciais exclusivos do GatilhoBR, sem que disso resulte qualquer direito a indenização.",
        ],
      },
      {
        title: "12. Alterações nos termos, legislação e foro",
        paragraphs: [
          "Estes Termos poderão ser alterados a qualquer tempo pelo GatilhoBR. Modificações relevantes serão informadas pelos canais oficiais e poderão exigir novo aceite.",
          "Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro competente nos termos da legislação vigente, resguardados os direitos de foro do consumidor quando aplicável.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de Privacidade",
    version: PRIVACY_VERSION,
    introduction:
      "Esta Política de Privacidade descreve como o GatilhoBR coleta, utiliza, armazena e protege os dados pessoais dos usuários da plataforma, dashboard, extensão e canais de suporte, em conformidade com a LGPD (Lei Geral de Proteção de Dados).",
    sections: [
      {
        title: "1. Controlador e atendimento",
        paragraphs: [
          "O controlador responsável pelo tratamento de dados é o operador legal do GatilhoBR. Dúvidas, solicitações ou exercício de direitos referentes à privacidade podem ser encaminhados por meio do suporte oficial integrado à plataforma.",
        ],
      },
      {
        title: "2. Dados pessoais coletados",
        bullets: [
          "Cadastro e conta: e-mail, identificador de usuário, credenciais de acesso autenticadas e histórico de licença.",
          "Dados técnicos e de segurança: identificador do dispositivo (fingerprint técnico), endereço IP, registros de acesso, versão da extensão/navegador e logs de prevenção a fraudes.",
          "Preferências e uso operacional: binds configuradas, presets, mercados favoritos, jogadores prioritários, stakes padrão, histórico técnico de execução de atalhos e logs de uso.",
          "Pagamentos e assinatura: identificadores Pix da cobrança (txid), valores, cupons, status de confirmação e datas. Não armazenamos senhas bancárias ou dados de cartões de crédito.",
          "Atendimento e afiliados: dados fornecidos no suporte, histórico de indicações, comissões e dados cadastrais de afiliados.",
        ],
      },
      {
        title: "3. Finalidades do tratamento e bases legais",
        paragraphs: [
          "Os dados são coletados e tratados para permitir o funcionamento da extensão, autenticar acessos, sincronizar atalhos e preferências, validar licenças ativas, processar cobranças Pix, prevenir fraudes, manter a segurança da aplicação, cumprir obrigações contratuais/legais e resguardar direitos em processos ou auditorias.",
          "As bases legais aplicadas incluem execução de contrato, legítimo interesse para segurança e aprimoramento do serviço, cumprimento de obrigação legal e exercício regular de direitos.",
        ],
      },
      {
        title: "4. Compartilhamento e operadoras terceiras",
        paragraphs: [
          "O GatilhoBR compartilha dados estritamente necessários com provedores de infraestrutura de nuvem e autenticação (Supabase), processamento financeiro Pix (Efí Bank) e ferramentas de auditoria e segurança.",
          "As casas de apostas são controladoras independentes. O GatilhoBR não controla nem se responsabiliza pelo tratamento de dados realizado pelas casas de apostas nos navegadores dos usuários.",
          "Não vendemos nem comercializamos dados pessoais de usuários com terceiros.",
        ],
      },
      {
        title: "5. Tratamento em casos de suspensão ou cancelamento de conta",
        paragraphs: [
          "Em situações de suspensão, bloqueio ou cancelamento unilateral da conta do usuário por razões de segurança, infração contratual ou encerramento do serviço, o GatilhoBR manterá os registros técnicos de acesso, dados de transação e evidências de aceite jurídico pelos prazos exigidos por lei (como o Marco Civil da Internet e o Código Civil) para fins de auditoria, proteção contra fraudes e defesa em processos judiciais ou administrativos.",
        ],
      },
      {
        title: "6. Armazenamento e segurança das informações",
        paragraphs: [
          "Adotamos medidas técnicas e organizacionais de segurança para proteger seus dados contra acessos não autorizados, perda ou alteração. Os tokens de sessão e preferências locais podem ser mantidos no chrome.storage do navegador.",
          "O usuário é responsável por manter a confidencialidade de sua senha e por encerrar a sessão em computadores compartilhados.",
        ],
      },
      {
        title: "7. Direitos do titular dos dados",
        paragraphs: [
          "Nos termos da LGPD, o usuário possui o direito de solicitar confirmação da existência de tratamento, acesso aos dados, correção de dados incompletos ou desatualizados, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade e revogação do consentimento quando aplicável.",
          "Tais solicitações serão atendidas após a validação da identidade do requerente, observando os prazos e exceções previstos na legislação de regência.",
        ],
      },
      {
        title: "8. Alterações nesta Política",
        paragraphs: [
          "Esta Política de Privacidade poderá ser atualizada a qualquer tempo para refletir melhorias no produto ou exigências legais. A data da última versão estará sempre atualizada no cabeçalho do documento.",
        ],
      },
    ],
  },
};


