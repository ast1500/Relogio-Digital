# Vídeo Limpo

Remove GPS, modelo do aparelho, datas e outros metadados de vídeos, direto no navegador.
Veja o [README principal](../README.md) para detalhes.

| Arquivo | O que faz |
|---|---|
| `index.html` | Interface |
| `style.css` | Visual neo-brutalista (contornos grossos, sombras sólidas, cartões em forma de pasta) |
| `app.js` | Lista de arquivos, pastas → .zip (até 100 vídeos), limpeza rápida, limpeza profunda e downloads |
| `zip.js` | Gerador de .zip sem bibliotecas: sem compressão, ZIP64, nomes UTF-8, data fixa |
| `metadata.js` | Análise e limpeza sem re-codificar de MP4/MOV/M4V/3GP e WebM/MKV. Funciona também no Node |
| `favicon.svg` | Ícone |

## Usar o limpador no Node

```js
// node 22+
const VideoMeta = require('./metadata.js');
const blob = await require('fs').openAsBlob('video.mov');
console.log((await VideoMeta.analyze(blob)).findings);   // o que o arquivo revela
const { blob: limpo } = await VideoMeta.clean(blob);     // cópia sem metadados
```
