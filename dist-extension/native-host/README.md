# Native Messaging (protótipo local)

Este diretório contém um host mínimo de diagnóstico para a extensão GatilhoBR.
Ele usa o framing oficial do Chrome (4 bytes little-endian com o tamanho, seguido
de JSON UTF-8) e retransmite mensagens pela named pipe fixa
`\\.\pipe\gatilhobr-native-bridge`, mantida pelo processo Electron. Não executa
apostas, não acessa a rede e não registra nada no Windows automaticamente.

## Instalação assistida no Windows

1. O manifesto aponta para `gatilhobr-host.exe`, um launcher/runtime empacotado
   que deve ficar junto deste diretório. O arquivo `.js` é a implementação de
   referência para gerar esse executável (por exemplo, com `pkg`); o Chrome não
   aceita argumentos de script no manifesto Native Messaging.
2. Copie `com.gatilhobr.native_messaging.json` para:
   `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\` (Chrome) ou
   `%LOCALAPPDATA%\Microsoft\Edge\User Data\NativeMessagingHosts\` (Edge).
3. Edite `allowed_origins` e substitua `REPLACE_WITH_GATILHOBR_EXTENSION_ID`
   pelo ID exibido em `chrome://extensions` após carregar a extensão local.
4. Ajuste `path` para o caminho absoluto do launcher na máquina do cliente.
5. No service worker da extensão, conecte com:
   `chrome.runtime.connectNative('com.gatilhobr.native_messaging')`.

O Chrome inicia o processo sob demanda. Para depuração, erros são enviados para
`stderr`; a saída `stdout` é reservada exclusivamente às mensagens enquadradas.
