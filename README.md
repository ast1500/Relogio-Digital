<div align="center">

# 🛡️ Vídeo Limpo

**Remova GPS, modelo do aparelho, datas e outros metadados dos seus vídeos, direto no navegador.**
Nenhum arquivo sai do seu computador.

[![Testes](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml/badge.svg)](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/badge/vers%C3%A3o-2.0.0-ffd23f)](CHANGELOG.md)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-7b6cf6)](LICENSE)

[**Abrir o Vídeo Limpo**](https://ast1500.github.io/Relogio-Digital/Limpar-Metadados/) · [Histórico de versões](CHANGELOG.md)

</div>

---

## Por que limpar metadados?

Um vídeo gravado no celular costuma carregar **as coordenadas de onde foi gravado**, o modelo do aparelho
(às vezes até o número de série) e a data e hora exatas. Ao mandar o arquivo por e-mail, Drive, Telegram
("como arquivo") ou publicar num site, tudo isso vai junto. O Vídeo Limpo mostra o que cada arquivo revela e
entrega uma cópia limpa.

| | O que é removido | Exemplos |
|---|---|---|
| 📍 | **Localização** | coordenadas GPS (`©xyz`, `loci`, chaves Apple/Android, tags MKV), nome do local |
| 📱 | **Aparelho** | fabricante, modelo, número de série, firmware, lente |
| 📅 | **Datas** | criação e modificação (inclusive as datas internas de cada trilha) |
| 🏷️ | **Software e textos** | apps e versões usados, título, autor, comentários, XMP, anexos |

## Como usar

1. Abra <https://ast1500.github.io/Relogio-Digital/Limpar-Metadados/> (o processamento acontece no seu aparelho, mesmo online).
2. Arraste um ou vários vídeos.
3. Veja o que cada um revela e toque em **Baixar limpo** (ou **Limpar todos**).

**Limpeza rápida** (padrão), para MP4, MOV, M4V, 3GP, WebM e MKV: apaga os metadados **sem re-codificar**. O vídeo
e o áudio ficam byte a byte iguais, o tamanho do arquivo não muda e funciona até com arquivos de vários GB.

**Limpeza profunda**: grava o vídeo de novo, do zero. Serve para o que a rápida não alcança, como as trilhas de
telemetria GPS de GoPros e drones e formatos desconhecidos. Leva o tempo de duração do vídeo.

Depois de cada limpeza, o arquivo é analisado de novo para confirmar que não sobrou nada ("0 restantes").

### No seu computador

```bash
git clone https://github.com/ast1500/Relogio-Digital.git
cd Relogio-Digital
npm start            # ou: python3 -m http.server 8000
# abra http://localhost:8000/Limpar-Metadados/
```

Não há dependências nem etapa de build: são arquivos HTML, CSS e JavaScript puros.

## Estrutura

```
Relogio-Digital/
├── Limpar-Metadados/     ← Vídeo Limpo (o projeto principal)
│   ├── index.html        interface
│   ├── style.css         visual
│   ├── app.js            lista de arquivos, limpeza rápida e profunda
│   └── metadata.js       leitura e limpeza de metadados (também roda no Node)
├── Editor-de-Video/      redireciona para Limpar-Metadados/ (endereço da v1)
├── Relógio-Digital/      o relógio digital original
├── tests/                testes do limpador (com vídeos de exemplo)
└── index.html            página inicial do site
```

## Como funciona por dentro

- **MP4/MOV:** percorre os blocos do arquivo, transforma `udta`, `meta` e XMP em blocos `free` com conteúdo zerado
  e zera as datas de `mvhd`, `tkhd` e `mdhd`. Nenhum tamanho muda, então os offsets do vídeo continuam válidos.
- **WebM/MKV:** transforma `Tags` e anexos em elementos `Void`, zera título, apps e nomes de trilha e apaga a data,
  também sem mudar tamanhos. Os `Clusters` (vídeo e áudio) são copiados sem tocar.
- O arquivo final é montado com `Blob.slice()`: o vídeo nunca é carregado inteiro na memória.
- A limpeza profunda desenha cada quadro num `<canvas>` e grava com `MediaRecorder`, gerando um arquivo novo.

## Desenvolvimento

```bash
npm test     # 12 testes do limpador (Node 22+)
```

Os vídeos em `tests/fixtures/` têm metadados **falsos** (GPS de pontos turísticos), gerados com `ffmpeg` só para teste.
Para publicar uma versão: atualize o `CHANGELOG.md` e rode **Actions → Criar Release → Run workflow** com a tag (ex.: `v2.1.0`).

## Licença

[MIT](LICENSE) © 2026 ast1500
