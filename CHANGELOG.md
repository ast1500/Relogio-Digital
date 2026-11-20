# Histórico de versões

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [2.2.2] - 2026-11-20

### Corrigido
- Depois de uma atualização, o Safari podia continuar mostrando a versão antiga guardada em cache. Agora os arquivos
  levam o número da versão no endereço e, se a página aberta for antiga, aparece o aviso **"Nova versão disponível → Atualizar"**.

## [2.2.1] - 2026-11-20

### Adicionado
- Suporte ao **Login do Facebook para Empresas**: campo "ID da configuração" (também em `config.js`).
- Depois do login, o app confere as permissões concedidas e explica o que falta (ex.: `pages_manage_posts`).

### Corrigido
- Trocar o App ID sem recarregar a página agora reconfigura o login do Facebook.

## [2.2.0] - 2026-11-20

### Adicionado
- **Agendar no Facebook** (fase 1): depois de limpar uma pasta ou vídeos soltos, agende tudo na sua Página do Facebook.
  - Conexão com "Entrar com Facebook"; o SDK da Meta só é carregado quando você toca em Entrar.
  - **Vídeos e Reels**: Reel automático para vídeos verticais de até 90 s, com troca manual por vídeo.
  - **Preencher em massa**: legenda e título modelo (`{n}`, `{total}`, `{nome}`, `{data}`, `{hora}`), hashtags
    (substituir ou somar) com **conjuntos salvos**, **distribuir datas** (horários por dia e dias da semana) e tipo.
  - **Planilha CSV** (Excel / Google Planilhas): baixar a fila, preencher e importar de volta.
  - Validações antes do envio: janela de 10 min a 6 meses (vídeo) ou 29 dias (Reel), Reel vertical e curto,
    horários repetidos, legenda vazia, excesso de hashtags.
  - Envio em fila, em partes, com progresso, "tentar de novo" por vídeo e cancelamento. Só sobem vídeos já limpos.
  - **Modo simulação** para testar tudo sem conta.
- `config.js` para o App ID público do Facebook (também dá para informar na tela).
- 31 testes no total (regras de agendamento e chamadas à Graph API com servidor falso).

## [2.1.2] - 2026-11-20

### Alterado
- No iPhone/iPad, passo a passo na tela para escolher a pasta no app Arquivos (entrar na pasta e tocar em Abrir;
  os vídeos aparecem apagados, e isso é normal).
- **Selecionar vídeos** vira um botão visível ao lado de "Importar pasta" (serve para vídeos que estão só no app Fotos).
- Aviso quando a pasta escolhida não entrega nenhum arquivo.

## [2.1.1] - 2026-11-20

### Alterado
- **Importar pasta** volta a ser o botão principal também no iPhone/iPad (o Safari abre pastas desde o iOS 18.4).
  A seleção de vários vídeos fica como alternativa para aparelhos mais antigos.

## [2.1.0] - 2026-11-20

### Adicionado
- **Pasta inteira → um .zip**: importe uma pasta (ou arraste-a para a página) com até **100 vídeos**; todos são
  limpos e, no fim, você baixa **um único .zip** com os vídeos limpos.
  - Subpastas são mantidas dentro do .zip (com nomes originais) ou os nomes viram aleatórios.
  - Arquivos que não são vídeo, vazios ou ocultos (como `._arquivo` do macOS) são ignorados.
  - Opção de usar a limpeza profunda nos vídeos que a rápida não alcança.
  - Alternativa de escolher vários vídeos para o mesmo .zip.
- Gerador de .zip próprio (`zip.js`), sem bibliotecas: sem compressão, sem copiar os vídeos na memória,
  ZIP64 para mais de 4 GB e data fixa (1980-01-01) para o .zip não revelar quando foi feito.
- Testes do .zip (15 testes no total).

 - 2026-11-20

O projeto passa a se chamar **Vídeo Limpo** e faz uma coisa só: **remover os metadados** dos vídeos.

### Removido
- O editor (legendas, estilos, fontes, cortes, velocidade e volume) e as fontes incluídas.

### Adicionado
- **Limpeza rápida de WebM/MKV sem re-codificar**: tags (com nome e valor, como GPS, autor e comentário), título,
  apps de gravação, data, nomes de trilha e anexos são removidos; os blocos de vídeo ficam idênticos.
- **Vários vídeos de uma vez**, com análise individual e o botão "Limpar todos".
- **Limpeza profunda** (re-codifica o vídeo do zero, sem edição) para o que a rápida não alcança:
  trilhas de telemetria GPS (GoPro, drones) e formatos desconhecidos.
- Verificação automática depois de cada limpeza ("0 restantes").

### Alterado
- Novo endereço: `Limpar-Metadados/`. O antigo `Editor-de-Video/` redireciona para ele.
- O site passa a ser publicado direto da branch `main` (o workflow de Pages foi removido).
- Testes ampliados para WebM/MKV (12 testes).

## [1.0.0] - 2026-11-20

Primeira versão, como **Editor Limpo** (editor de vídeo com limpeza de metadados).

### Legendas
- Legendas com tempo de início e fim, criadas no ponto atual do vídeo.
- 8 estilos prontos, incluindo "Amarelo" (caixa amarela arredondada com letras pretas em Montserrat Black).
- 9 fontes incluídas no projeto (funcionam offline): Montserrat Black/Bold, Poppins, Archivo Black, Anton,
  Bebas Neue, Oswald, Bangers e Permanent Marker.
- Fundo atrás das letras: caixa única, uma caixa por linha ou sem fundo, com cor, opacidade,
  arredondamento e espaço interno ajustáveis.
- Tamanho, cor, MAIÚSCULAS, contorno (fino/grosso), sombra, posição vertical e largura máxima.
- Importar `.srt`/`.vtt` e baixar `.srt` já ajustado aos cortes e à velocidade.
- O último estilo usado fica salvo no navegador.

### Cortes e velocidade
- Vários cortes: dividir na posição atual e remover trechos; a prévia pula o que foi removido.
- Velocidade de 0,5× a 3×, volume até 200% ou sem áudio.

### Metadados
- Análise de metadados MP4/MOV (GPS, `loci` 3GPP, fabricante, modelo, números de série, datas, software,
  XMP, trilhas de telemetria) e WebM/MKV (título, data, apps).
- Limpeza rápida de MP4/MOV sem re-codificar: blocos zerados, vídeo e áudio intactos, funciona com arquivos grandes.
- Exportação re-codificada sempre gera um arquivo novo, sem nenhum metadado do original, com nome aleatório.

### Projeto
- Interface neo-brutalista responsiva (computador e celular), 100% no navegador, sem servidor.
- Testes automatizados do limpador de metadados (`npm test`) e integração contínua no GitHub Actions.
- Publicação automática no GitHub Pages e criação de Release a cada tag `v*`.
- Licença MIT.

[2.2.2]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.2.2
[2.2.1]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.2.1
[2.2.0]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.2.0
[2.1.2]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.1.2
[2.1.1]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.1.1
[2.1.0]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.1.0
[2.0.0]: https://github.com/ast1500/Relogio-Digital/releases/tag/v2.0.0
[1.0.0]: https://github.com/ast1500/Relogio-Digital/releases/tag/v1.0.0
