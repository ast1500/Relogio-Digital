# Editor Limpo 🎬🔒

Coloque **legendas estilizadas**, faça **cortes**, **acelere** e **remova os metadados** (GPS, aparelho, datas, software) do seu vídeo, tudo **dentro do navegador**.
Nenhum arquivo é enviado para servidores.

## Como usar

Abra `index.html` no navegador (Chrome, Edge, Firefox ou Safari) ou sirva a pasta:

```bash
cd Editor-de-Video
python3 -m http.server 8000   # depois abra http://localhost:8000
```

1. Arraste um vídeo para a página.
2. **Legendas**: vá até o momento da fala e toque em **Adicionar no ponto atual**. Ajuste início e fim
   (o botão de relógio usa a posição atual). Também dá para importar e baixar arquivos `.srt`.
3. **Estilo da legenda**: escolha um estilo pronto (o "Amarelo" é a caixa amarela com letras pretas) ou personalize
   a fonte (9 opções, incluídas na pasta `fonts/`), o tamanho, a cor, MAIÚSCULAS, o **fundo atrás das letras**
   (caixa única, uma caixa por linha ou sem fundo; cor, opacidade, arredondamento e espaço interno), o contorno,
   a sombra e a posição.
4. **Cortes**: **Dividir aqui** separa o vídeo na posição atual; toque num trecho e use **Remover trecho**.
5. **Velocidade**: de 0,5× a 3×.
6. **Exportar vídeo**: sai com tudo aplicado e **sem nenhum metadado** do original.
   Ou use **Limpar sem editar** para só tirar os metadados do arquivo original, sem perder qualidade.

Atalhos: `espaço` reproduz/pausa · `L` nova legenda · `S` divide · `Delete` remove o trecho · `←`/`→` quadro a quadro (`Shift` = 5 s).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | Interface |
| `style.css` | Visual neo-brutalista (contornos grossos, sombras sólidas, cartões em forma de pasta) |
| `favicon.svg` | Ícone |
| `app.js` | Editor: legendas, cortes, velocidade, prévia em Canvas, exportação com MediaRecorder |
| `fonts/` | Fontes das legendas (locais, licenças em `fonts/LICENCAS.md`) |
| `metadata.js` | Leitura e limpeza de metadados MP4/MOV (e leitura de WebM). Funciona também no Node |
| `IDEIA.md` | A ideia em detalhe: problema, público, arquitetura, limitações e roadmap |

## Testar o limpador no Node

```js
// node 22+
const VideoMeta = require('./metadata.js');
const blob = await require('fs').openAsBlob('video.mov');
console.log((await VideoMeta.analyze(blob)).findings);
const { blob: limpo } = await VideoMeta.clean(blob);
```
