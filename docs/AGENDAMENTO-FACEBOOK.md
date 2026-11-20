# Agendar no Facebook: especificação

> Status: **proposta**. Nada disto está implementado ainda.

## 1. A ideia

Hoje o Vídeo Limpo limpa até 100 vídeos de uma vez. A próxima etapa natural é **publicar** esses vídeos:
depois de limpar a pasta, a pessoa conecta a Página do Facebook, escreve legendas e hashtags (uma a uma ou em massa),
distribui as datas num calendário e envia tudo **já agendado**. O Facebook guarda os vídeos e publica cada um na hora certa.

```
 pasta com vídeos ──► limpar metadados ──► legendas + hashtags ──► datas ──► enviar agendado ──► Facebook publica sozinho
   (já existe)          (já existe)            (novo)              (novo)       (novo)
```

## 2. O que o Facebook permite (e o que não permite)

| Destino | Agendar pela API? | Observação |
|---|---|---|
| **Página do Facebook: vídeo** | ✅ Sim | `published=false` + `scheduled_publish_time`, de **10 minutos a 6 meses** no futuro ([Page Videos](https://developers.facebook.com/docs/graph-api/reference/page/videos/)) |
| **Página do Facebook: Reels** | ✅ Sim, com janela menor | Guias citam até ~29 dias; confirmar na referência de Video Reels antes de implementar |
| **Perfil pessoal** | ❌ Não | A Meta não permite publicar em perfis pessoais pela API desde 2018 |
| **Grupos** | ❌ Não | A API de publicação em grupos foi descontinuada |
| **Instagram (Reels/feed)** | ⚠️ Só publicar na hora | A API do Instagram não tem agendamento nativo ([Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)). Agendar exigiria um servidor próprio que publique na hora certa |

**Conclusão:** a fase 1 é **Página do Facebook (vídeos e Reels)**. Ela funciona **sem servidor**, porque quem guarda e
publica é o próprio Facebook. O Instagram fica para uma fase com servidor.

## 3. Fluxo na tela

1. **Limpar**: igual a hoje (pasta → vídeos limpos).
2. **Conectar**: botão **Entrar com Facebook** → escolher a **Página**.
3. **Montar a fila**: uma tabela com cada vídeo:
   miniatura · nome · tipo (Vídeo/Reel) · título · legenda · hashtags · data e hora · status.
4. **Ferramentas em massa** (aplicam a todos ou aos selecionados):
   - **Legenda modelo** com variáveis: `{n}` (número do vídeo), `{nome}` (nome do arquivo), `{data}`.
     Ex.: `Parte {n} da viagem ✈️`.
   - **Conjuntos de hashtags salvos**: ex. "Viagem" = `#viagem #praia #ferias`. Um toque aplica o conjunto.
     Contador por vídeo e aviso quando passar do recomendado (3 a 5 no Facebook).
   - **Distribuir datas**: começar em [data], [N] vídeos por dia nos horários [12:00, 19:00], só nos dias [seg–sex],
     fuso horário do aparelho. Ex.: 30 vídeos, 2 por dia → 15 dias de conteúdo em um clique.
   - **Embaralhar ordem**, **pular feriados/datas** escolhidas.
   - **Importar/exportar planilha (CSV)**: `arquivo, titulo, legenda, hashtags, data, hora, tipo`.
     Permite preparar tudo no Excel/Google Planilhas.
5. **Revisar**: calendário com os vídeos de cada dia e avisos (ver §5).
6. **Enviar**: upload em fila (1 ou 2 por vez), em partes e retomável, com barra de progresso por vídeo e geral.
   Ao terminar, cada linha mostra ✅ "Agendado para 12/12 às 19:00" e o link do post.
   **Depois do envio, pode fechar a página:** a publicação acontece no Facebook.
7. **Agendados**: lista do que já está agendado na Página, com **reagendar** e **cancelar**.

## 4. Como funciona por dentro

- **Login:** SDK JavaScript do Facebook (Login para Empresas). O token do usuário gera, via `/me/accounts`, o
  **token da Página**. Os tokens ficam **só na memória** da aba e nunca vão para o repositório nem para o `localStorage`.
- **Permissões pedidas:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` e `publish_video`
  ([Pages API](https://developers.facebook.com/documentation/pages-api/manage-pages)).
- **Upload:** `POST /{page-id}/videos` em partes (`upload_phase=start → transfer → finish`), com `description` =
  legenda + hashtags, `title`, `published=false` e `scheduled_publish_time` em segundos Unix. Reels: endpoint
  `/{page-id}/video_reels` com o mesmo princípio.
- **Sem servidor:** continua um site estático (GitHub Pages). O App ID do Facebook é público e pode ficar no código;
  o **App Secret nunca** vai para o navegador nem para o repositório.
- **Privacidade:**
  - o SDK do Facebook **só é carregado quando a pessoa abre "Agendar no Facebook"**. Quem só limpa vídeos continua
    sem nenhuma chamada externa;
  - só sobem vídeos **já limpos** (a limpeza continua local e obrigatória antes do envio);
  - o selo muda para "Limpeza 100% local · envio ao Facebook só quando você pedir".
- **Modo simulação:** uma versão falsa da API para testar a tela inteira sem conta, usada também nos testes automáticos.

## 5. Validações antes de enviar

- Data entre 10 min e 6 meses (vídeo) ou dentro da janela de Reels.
- Reels: vertical (9:16) e duração dentro do limite do Facebook; se não servir, sugere "enviar como vídeo".
- Dois vídeos no mesmo horário → aviso.
- Legenda vazia → aviso (não bloqueia).
- Arquivo grande demais ou formato que o Facebook não aceita → bloqueia aquele vídeo e explica.
- Vídeo ainda não limpo → limpa antes de enviar.

## 6. O que precisa ser feito fora do código (pelo dono da conta)

1. Criar um app em [developers.facebook.com](https://developers.facebook.com) (tipo **Empresa**).
2. Adicionar **Login do Facebook para Empresas** e as permissões da §4.
3. Em *Domínios do app*, adicionar `ast1500.github.io`.
4. Passar o **App ID** (número público) para configurar o site.

- **Só para as suas Páginas:** com o app em *modo de desenvolvimento*, funciona para quem é admin/testador do app.
  Não precisa de revisão.
- **Para outras pessoas usarem:** precisa da **Revisão do App** da Meta (com vídeo demonstrando o uso) e
  verificação da empresa. Costuma levar semanas.

## 7. Fases

| Fase | Entrega |
|---|---|
| **1 (MVP)** | Login, escolher Página, tabela, legenda modelo, conjuntos de hashtags, distribuir datas, envio agendado de vídeos, resultado por vídeo, modo simulação |
| **2** | Reels, importar/exportar CSV, calendário visual, painel de agendados (reagendar/cancelar), miniatura personalizada |
| **3** | Instagram (precisa de servidor para agendar), melhores horários a partir das estatísticas da Página |

## 8. Riscos

- **Mudanças na API da Meta:** limites e permissões mudam com frequência. Cada endpoint é isolado num módulo
  (`facebook.js`) para ajustes rápidos.
- **Envio de 100 vídeos pelo celular:** depende da internet. O envio por partes permite retomar sem recomeçar,
  mas a aba precisa ficar aberta **durante o envio**.
- **Revisão do App:** se o objetivo for abrir para outras pessoas, a aprovação da Meta é o maior gargalo de prazo.
