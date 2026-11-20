<div align="center">

# 🛡️ Vídeo Limpo

**Remova GPS, modelo do aparelho, datas e outros metadados dos seus vídeos, direto no navegador. Depois, agende tudo na sua Página do Facebook.**
Nenhum arquivo sai do seu computador.

[![Testes](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml/badge.svg)](https://github.com/ast1500/Relogio-Digital/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/badge/vers%C3%A3o-2.3.1-ffd23f)](CHANGELOG.md)
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
2. Escolha um modo:
   - **Vídeo a vídeo:** arraste ou escolha os vídeos; veja o que cada um revela e toque em **Baixar limpo** (ou **Limpar todos**).
   - **Pasta inteira → um .zip:** toque em **Importar pasta** (ou arraste uma pasta) com até **100 vídeos** e depois em
     **Limpar tudo e baixar ZIP**. No fim vem um único `.zip` com todos os vídeos limpos, mantendo as subpastas.
     No iPhone/iPad (iOS 18.4 ou mais novo), **Importar pasta** abre o app Arquivos: **toque na pasta para entrar nela** (os vídeos
     aparecem apagados, é normal) e toque em **Abrir**, no canto superior direito. Para vídeos que estão só no app Fotos, use **Selecionar vídeos**.

**Limpeza rápida** (padrão), para MP4, MOV, M4V, 3GP, WebM e MKV: apaga os metadados **sem re-codificar**. O vídeo
e o áudio ficam byte a byte iguais, o tamanho do arquivo não muda e funciona até com arquivos de vários GB.

**Limpeza profunda**: grava o vídeo de novo, do zero. Serve para o que a rápida não alcança, como as trilhas de
telemetria GPS de GoPros e drones e formatos desconhecidos. Leva o tempo de duração do vídeo.

Depois de cada limpeza, o arquivo é analisado de novo para confirmar que não sobrou nada ("0 restantes").

### Agendar no Facebook

Depois de limpar uma pasta (ou vídeos soltos), toque em **Agendar no Facebook**. A tela é dividida em etapas:

1. **Conectar**: "Entrar com Facebook" e escolha a Página (ou teste no **modo simulação**).
2. **Legendas**: cole uma lista (uma por linha, ou separadas por linha em branco) e toque em **🎲 Sortear para todos**
   ou **Usar na ordem**. Aceita `{n}` e `{nome}`.
3. **Hashtags**: uma lista para sortear, **quantas por post** e hashtags **fixas** que vão em todos.
4. **Horários**: primeiro post + intervalo (padrão: **a cada 10 minutos**). Todos os horários ficam em passos de 10 minutos.
5. **Revisar**: cada post tem botões **🎲** para sortear outra legenda ou outras hashtags só para ele.
6. **Agendar**: os vídeos sobem já limpos e o Facebook publica cada um na hora marcada.

Em **Avançado** ficam o tipo de post (Vídeo/Reel), o título e a planilha CSV.

Funciona com **Páginas** do Facebook (vídeos e Reels). A Meta não permite publicar em perfis pessoais nem em grupos
pela API, e o Instagram não tem agendamento nativo. Detalhes em [docs/AGENDAMENTO-FACEBOOK.md](docs/AGENDAMENTO-FACEBOOK.md).

**Configuração (uma vez):** crie um app em [developers.facebook.com](https://developers.facebook.com) (tipo Empresa),
adicione o Login do Facebook para Empresas com as permissões `pages_show_list`, `pages_read_engagement`,
`pages_manage_posts` e `publish_video`, autorize o domínio `ast1500.github.io` e coloque o **App ID** em
`Limpar-Metadados/config.js` (ou informe na própria tela). Se o app usa o **Login do Facebook para Empresas**, crie uma
*configuração* (tipo "token de acesso do usuário", com as mesmas permissões) e informe também o **ID da configuração**. Para usar só nas suas Páginas, o app pode ficar em modo de
desenvolvimento, sem revisão da Meta. **Nunca** coloque o App Secret no código.

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
│   ├── app.js            lista de arquivos, pastas → .zip, limpeza rápida e profunda
│   ├── metadata.js       leitura e limpeza de metadados (também roda no Node)
│   ├── zip.js            gerador de .zip sem bibliotecas (ZIP64, nomes UTF-8, data fixa)
│   ├── schedule.js       regras do agendamento: hashtags, modelos, datas, validações, CSV
│   ├── facebook.js       conexão com a Graph API (e o modo simulação)
│   ├── scheduler.js      tela "Agendar no Facebook"
│   └── config.js         App ID público do Facebook
├── Editor-de-Video/      redireciona para Limpar-Metadados/ (endereço da v1)
├── Relógio-Digital/      o relógio digital original
├── docs/                 especificações (ex.: agendamento no Facebook)
├── tests/                testes (limpador, .zip, agendamento, Graph API)
└── index.html            página inicial do site
```

## Como funciona por dentro

- **MP4/MOV:** percorre os blocos do arquivo, transforma `udta`, `meta` e XMP em blocos `free` com conteúdo zerado
  e zera as datas de `mvhd`, `tkhd` e `mdhd`. Nenhum tamanho muda, então os offsets do vídeo continuam válidos.
- **WebM/MKV:** transforma `Tags` e anexos em elementos `Void`, zera título, apps e nomes de trilha e apaga a data,
  também sem mudar tamanhos. Os `Clusters` (vídeo e áudio) são copiados sem tocar.
- O arquivo final é montado com `Blob.slice()`: o vídeo nunca é carregado inteiro na memória.
- O `.zip` é montado sem compressão (vídeo já é comprimido) e também com `Blob`s, então 100 vídeos não ocupam o dobro da memória.
- A limpeza profunda desenha cada quadro num `<canvas>` e grava com `MediaRecorder`, gerando um arquivo novo.

## Desenvolvimento

```bash
npm test     # 31 testes: limpador, .zip, regras de agendamento e chamadas à Graph API (Node 22+)
```

Os vídeos em `tests/fixtures/` têm metadados **falsos** (GPS de pontos turísticos), gerados com `ffmpeg` só para teste.
Para publicar uma versão: atualize o `CHANGELOG.md` e rode **Actions → Criar Release → Run workflow** com a tag (ex.: `v2.1.0`).

## Licença

[MIT](LICENSE) © 2026 ast1500
