# Histórico de versões

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-11-20

Primeira versão do **Editor Limpo**.

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

[1.0.0]: https://github.com/ast1500/Relogio-Digital/releases/tag/v1.0.0
