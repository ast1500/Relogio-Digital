# Vídeo Limpo

Remove GPS, modelo do aparelho, datas e outros metadados de vídeos, direto no navegador.
Veja o [README principal](../README.md) para detalhes.

| Arquivo | O que faz |
|---|---|
| `index.html` | Interface |
| `style.css` | Visual neo-brutalista (contornos grossos, sombras sólidas, cartões em forma de pasta) |
| `app.js` | Lista de arquivos, limpeza rápida, limpeza profunda (re-codificação) e downloads |
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
