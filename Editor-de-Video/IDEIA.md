# Editor Limpo: a ideia em detalhe

## 1. O problema

Todo vídeo gravado no celular ou numa câmera carrega informações escondidas que quase ninguém vê:

| O que vaza | Onde fica no arquivo | Por que importa |
|---|---|---|
| **Coordenadas GPS** de onde foi gravado | `©xyz`, `loci`, `com.apple.quicktime.location.ISO6709` | Revela sua casa, sua escola, sua rotina |
| **Fabricante, modelo e número de série** | `©mak`, `©mod`, `SDLN`, `CAME` | Liga vídeos diferentes ao mesmo aparelho, ou seja, à mesma pessoa |
| **Data e hora exatas** | `mvhd`/`tkhd`/`mdhd`, `©day`, `creationdate` | Diz quando você estava em cada lugar |
| **Software e versão** | `©swr`, `©too`, `encoder` | Ajuda a identificar o aparelho e o sistema |
| **Telemetria** (GoPro, drones, Android) | trilhas `gpmd`, `camm`, `mebx` | Trajeto GPS completo, quadro a quadro |
| **Nome do arquivo** | fora do arquivo | `VID_20250601_102030.mp4` já entrega a data |

Algumas redes sociais removem parte disso ao publicar, mas **nem todas**, e nada é removido quando o vídeo é
enviado por e-mail, Drive, Telegram "como arquivo", Discord, fóruns ou sites próprios.

Os editores comuns fazem duas coisas ruins:
1. **Preservam os metadados** ao exportar (vários copiam a data e o GPS de propósito).
2. **Enviam o vídeo para servidores** (editores online), o que é justamente o oposto de privacidade.

## 2. A proposta

Um editor de vídeo **que roda 100% no navegador**: nenhum byte sai do computador e não é preciso instalar nada.
A limpeza de metadados não fica escondida num menu: é o **centro do produto**.

Dois caminhos, conforme o que a pessoa precisa:

### ⚡ Limpeza rápida (sem re-codificar)
- Para quem só quer **compartilhar com segurança**.
- Lê a estrutura do MP4/MOV, apaga os blocos de metadados e **zera** o conteúdo (renomear não basta: com um
  editor hexadecimal ainda daria para ler o GPS).
- Os tamanhos não mudam, então o vídeo e o áudio ficam **byte a byte idênticos** (verificado com `framemd5`).
- Instantânea, mesmo em arquivos de vários GB: só os cabeçalhos são carregados na memória.

### 🎬 Editar e exportar (re-codificando)
- Cortar, enquadrar (16:9, 9:16, 1:1, 4:5), girar, espelhar, mudar a resolução.
- Brilho, contraste, saturação, preto e branco, desfoque.
- Velocidade (0,5× a 2×), volume até 200% ou remover o áudio.
- Texto/legenda/marca d'água.
- **Ocultar áreas** (rostos, placas de carro, telas, endereços) com pixelização.
- O arquivo final é **gerado do zero** pelo navegador, então não herda nada do original. Isso também resolve o
  que a limpeza rápida não alcança: trilhas de telemetria e formatos que não são MP4.
- Nome de arquivo aleatório por padrão.

## 3. Para quem é

- **Pessoas comuns** que vendem coisas online, postam em grupos ou mandam vídeos para desconhecidos.
- **Jornalistas e fontes** que precisam proteger a localização de quem gravou.
- **Ativistas, vítimas de violência e denunciantes**, para quem o GPS de um vídeo pode ser perigoso.
- **Criadores de conteúdo** que filmam em casa.
- **Escolas e ONGs** que publicam vídeos com crianças (ocultar rostos + remover local).

## 4. Como funciona por dentro

```
            ┌───────────────────────── navegador ─────────────────────────┐
 arquivo ──►│ metadata.js: lê os blocos do MP4/MOV ou o EBML do WebM       │
            │    ├─ analyze() → lista de achados (gravidade, categoria)    │
            │    └─ clean()   → Blob novo: blocos zerados + mdat original  │──► download (limpo, qualidade original)
            │                                                              │
            │ <video> ─► Canvas 2D (recorte, giro, filtros, texto, pixel.) │
            │    │                    └─ canvas.captureStream(30 fps)      │
            │    └─► Web Audio (ganho) ─► MediaStreamDestination           │
            │                 └──────────► MediaRecorder (MP4 ou WebM) ────│──► download (editado, sem metadados)
            └──────────────────────────────────────────────────────────────┘
```

- **Sem dependências, sem build, sem servidor.** São três arquivos estáticos (HTML, CSS, JS). Dá para publicar no
  GitHub Pages ou abrir de um pendrive.
- A prévia e a exportação usam **a mesma função de desenho**: o que se vê é o que sai.
- `metadata.js` também roda no Node (para testes automatizados).

## 5. Limitações atuais (honestas)

- A exportação acontece **em tempo real**: 1 minuto de vídeo leva cerca de 1 minuto. A aba precisa ficar visível.
- WebM gravado pelo navegador costuma sair **sem a duração no cabeçalho** (alguns players não deixam avançar).
  O Chrome recente grava MP4, o que evita isso.
- Vídeos HEVC (padrão do iPhone) só têm prévia em navegadores que decodificam HEVC (Safari, Chrome/Edge com suporte do
  sistema). A **limpeza rápida funciona sempre**, porque não precisa decodificar.
- A limpeza rápida **não remove trilhas de telemetria** (`gpmd`, `camm`). O app avisa e indica a exportação.
- Não há trilha do tempo com vários clipes (por enquanto é um vídeo por vez).

## 6. Próximos passos (roadmap)

**Curto prazo**
1. **Lote**: arrastar 50 vídeos e limpar todos de uma vez, baixando um `.zip`.
2. **Relatório antes/depois**: mostrar "removemos GPS de Nova York, iPhone 15 Pro, 01/06/2025 10:20".
3. **Mapa** mostrando onde o vídeo foi gravado, para assustar com propósito.
4. **Remover trilhas de telemetria** na limpeza rápida (reescrever `moov` sem a trilha e ajustar os offsets).
5. **Limpar imagens também** (EXIF de JPEG/HEIC/PNG): a mesma dor, um público maior.

**Médio prazo**
6. **Exportação mais rápida que o tempo real** com **WebCodecs** + um muxer MP4 (`VideoEncoder` acelerado por hardware).
7. **Detecção automática de rostos e placas** (modelos leves no navegador) para sugerir as áreas a ocultar, com
   rastreamento ao longo do vídeo.
8. **Distorção de voz** para depoimentos anônimos.
9. **PWA instalável e offline**, com "Compartilhar → Editor Limpo" no celular (Web Share Target).
10. **Vários clipes**, transições e trilha sonora.

**Ideias extras**
- **Modo "verificar antes de postar"**: só analisa e dá uma nota de risco (verde/amarelo/vermelho).
- **Extensão do navegador** que intercepta uploads de vídeo e oferece limpar antes de enviar.
- **Remover "impressões" invisíveis**: re-codificar já elimina quase tudo, mas um ruído leve opcional dificulta
  identificar a câmera pelo padrão do sensor (PRNU).

## 7. Por que isso pode dar certo

- **Confiança verificável**: o código é aberto e roda local; dá para desligar a internet e usar.
- **Custo zero de servidor**: o processamento é do usuário, então escalar não custa nada.
- **Nicho com dor real e pouca oferta boa**: as ferramentas de metadados são de linha de comando (`exiftool`,
  `ffmpeg`), e os editores amigáveis não se preocupam com privacidade.
