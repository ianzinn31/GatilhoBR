# Instalação assistida da extensão Chrome

Execute `Install-GatilhoBRChrome.ps1` (botão direito → **Executar com
PowerShell**) na primeira execução do GatilhoBR. O script copia a extensão para
`%LOCALAPPDATA%\GatilhoBR\chrome-extension`, registra o host Native Messaging
no perfil do usuário e abre `chrome://extensions`.

No Chrome, ative **Modo do desenvolvedor** e escolha **Carregar sem
compactação**, selecionando a pasta indicada. Essa confirmação é exigida pelo
Chrome para extensões locais que não estão na Web Store.

Para distribuição assinada, coloque um `gatilhobr-host.exe` no diretório
`native-host` e atualize o campo `path` do manifesto para esse executável.
