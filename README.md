<div align="center">

# ▶ Editor Limpo

**Legende, corte, acelere e remova os metadados dos seus vídeos, direto no navegador.**
Nenhum arquivo sai do seu computador.

[![Testes](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml/badge.svg)](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/badge/vers%C3%A3o-1.0.0-ffd23f)](CHANGELOG.md)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-7b6cf6)](LICENSE)

[**Abrir o editor**](https://ast1500.github.io/Relogio-Digital/Editor-de-Video/) · [Histórico de versões](CHANGELOG.md) · [A ideia em detalhe](Editor-de-Video/IDEIA.md)

</div>

---

## O que ele faz

| | Recurso | Detalhes |
|---|---|---|
| 🟨 | **Legendas** | Com tempo de início e fim, 8 estilos prontos, 9 fontes, **fundo atrás das letras** (caixa, por linha ou sem fundo), contorno, sombra e posição. Importa e exporta `.srt`. |
| ✂️ | **Cortes** | Divida o vídeo onde quiser e remova os trechos que não servem. |
| ⚡ | **Velocidade** | De 0,5× a 3×, com volume ajustável ou sem áudio. |
| 🛡️ | **Limpar metadados** | Mostra e remove GPS, modelo do aparelho, número de série, datas, software e XMP. |

### Por que limpar metadados?

Um vídeo gravado no celular costuma carregar **as coordenadas de onde foi gravado**, o modelo do aparelho e a
data e hora exatas. Ao mandar o arquivo por e-mail, Drive, Telegram ("como arquivo") ou publicar num site,
tudo isso vai junto. O Editor Limpo mostra o que o arquivo revela e entrega uma cópia limpa.

- **Limpar sem editar** (MP4/MOV): remove os metadados **sem perder qualidade**, porque o vídeo e o áudio ficam byte a byte iguais.
- **Exportar vídeo**: gera um arquivo novo, com legendas, cortes e velocidade aplicados, e **sem nenhum** metadado do original.

## Como usar

**Online:** abra <https://ast1500.github.io/Relogio-Digital/Editor-de-Video/>. Mesmo online, o processamento acontece no seu aparelho.

**No seu computador:**

```bash
git clone https://github.com/ast1500/Relogio-Digital.git
cd Relogio-Digital
npm start            # ou: python3 -m http.server 8000
# abra http://localhost:8000/Editor-de-Video/
```

Não há dependências nem etapa de build: são arquivos HTML, CSS e JavaScript puros.

Atalhos: `espaço` reproduz/pausa · `L` nova legenda · `S` divide · `Delete` remove o trecho · `←`/`→` quadro a quadro.

## Estrutura

```
Relogio-Digital/
├── Editor-de-Video/      ← Editor Limpo (o projeto principal)
│   ├── index.html        interface
│   ├── style.css         visual
│   ├── app.js            legendas, cortes, velocidade e exportação
│   ├── metadata.js       leitura e limpeza de metadados (também roda no Node)
│   ├── fonts/            fontes das legendas (licenças em fonts/LICENCAS.md)
│   ├── README.md         guia do editor
│   └── IDEIA.md          problema, público, arquitetura e roadmap
├── Relógio-Digital/      ← o relógio digital original
├── tests/                testes do limpador de metadados
├── index.html            página inicial do site
└── .github/              CI, publicação no GitHub Pages e Releases
```

## Desenvolvimento

```bash
npm test     # roda os testes do limpador (Node 22+)
```

Os testes usam vídeos pequenos em `tests/fixtures/` com metadados **falsos** (GPS de pontos turísticos),
gerados com `ffmpeg` só para isso.

**Como funciona por dentro:** a prévia e a exportação desenham cada quadro num `<canvas>` (vídeo + legenda),
o áudio passa pela Web Audio API e o resultado é gravado com `MediaRecorder`. A limpeza rápida percorre os blocos
do MP4/MOV, zera `udta`/`meta`/XMP e as datas de `mvhd`/`tkhd`/`mdhd` sem mudar nenhum tamanho, e monta o arquivo final
com `Blob.slice()`, sem carregar o vídeo inteiro na memória.

## Compatibilidade

Funciona nas versões atuais de Chrome, Edge, Firefox e Safari (computador e celular). O formato exportado
depende do navegador: o Chrome grava MP4 (H.264); outros podem gravar WebM. Vídeos HEVC (padrão do iPhone) só
têm prévia em navegadores que decodificam HEVC, mas a limpeza de metadados funciona sempre.

## Licença

[MIT](LICENSE) © 2026 ast1500. As fontes incluídas têm licenças próprias (SIL OFL 1.1 e Apache 2.0).
