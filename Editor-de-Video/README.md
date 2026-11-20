# Editor Limpo 🎬🔒

Editor de vídeo que roda **inteiro no navegador** e **remove os metadados** (GPS, aparelho, datas, software).
Nenhum arquivo é enviado para servidores.

## Como usar

Abra `index.html` no navegador (Chrome, Edge, Firefox ou Safari) ou sirva a pasta:

```bash
cd Editor-de-Video
python3 -m http.server 8000   # depois abra http://localhost:8000
```

1. Arraste um vídeo para a página.
2. Veja em **Metadados encontrados** tudo o que o arquivo revela.
3. Escolha:
   - **⚡ Limpar sem re-codificar**: baixa o mesmo vídeo, com a mesma qualidade, sem os metadados (MP4/MOV).
   - **Editar e ⬇ Exportar**: corte, enquadramento, giro, cores, velocidade, volume, texto e áreas pixeladas.
     O arquivo final é gerado do zero, sem nada do original.

Atalhos: `espaço` reproduz/pausa · `I`/`O` marcam início/fim · `←`/`→` avançam quadro a quadro (`Shift` = 5 s).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | Interface |
| `style.css` | Visual (mesma paleta do Relógio Digital) |
| `app.js` | Editor: prévia em Canvas, Web Audio, exportação com MediaRecorder |
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
