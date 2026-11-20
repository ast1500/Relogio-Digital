/*
 * scheduler.js — tela "Agendar no Facebook".
 * Recebe os vídeos do limpador (Scheduler.open) e cuida de: conexão com a Página, ferramentas em massa
 * (legenda modelo, hashtags, datas, tipo, planilha), fila editável, validação e envio agendado.
 * Depende de: schedule.js (Agenda) e facebook.js (FacebookPages).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const A = window.Agenda;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const WEEK_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  // ---------- preferências (só neste navegador) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vl-agenda-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vl-agenda-' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };
  const configAppId = () => store.get('appId', '') || ((window.VIDEO_LIMPO_CONFIG || {}).facebookAppId || '');
  const configLoginId = () => store.get('configId', '') || ((window.VIDEO_LIMPO_CONFIG || {}).facebookConfigId || '');

  const S = {
    open: false, title: '', rows: [], hidden: [],
    engine: null, user: null, pages: [], pageId: null, connecting: false, connectError: '',
    sending: false, controller: null, sentAt: null,
  };
  let nextRow = 1;

  function fmtSize(b) { const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i]; }
  function fmtDur(s) { if (!s || !isFinite(s)) return ''; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function fmtWhen(d) { return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' às ' + A.fmtTime(d); }
  const toast = (m, e) => window.VideoLimpoToast && window.VideoLimpoToast(m, e);

  // ---------- abrir / fechar ----------

  const HIDE_WHILE_OPEN = ['dropzone', 'options', 'groups', 'files', 'about'];
  let restore = [];

  function open({ title, entries, excluded }) {
    if (S.sending) return toast('Espere terminar o envio em andamento.', true);
    S.title = title || 'Vídeos';
    S.rows = entries.map((e, i) => ({
      id: nextRow++, n: i + 1, entry: e, name: e.name, size: e.file.size, meta: null, thumb: null,
      kind: 'video', kindAuto: true, title: '', caption: '', hashtags: '', when: null,
      selected: false, status: 'pending', progress: 0, error: '', result: null, note: e.warn || '',
    }));
    S.hidden = excluded || [];
    S.open = true;
    restore = HIDE_WHILE_OPEN.map((id) => [id, $(id).hidden]);
    HIDE_WHILE_OPEN.forEach((id) => { $(id).hidden = true; });
    $('scheduler').hidden = false;
    renderAll();
    window.scrollTo({ top: 0 });
    loadMetaQueue();
  }
  function close() {
    if (S.sending) return toast('Espere terminar ou cancele o envio antes de sair.', true);
    S.open = false;
    $('scheduler').hidden = true;
    restore.forEach(([id, h]) => { $(id).hidden = h; });
    if (window.VideoLimpoRefresh) window.VideoLimpoRefresh();
  }

  // ---------- miniatura, dimensões e duração (um vídeo por vez) ----------

  async function loadMetaQueue() {
    for (const r of S.rows) {
      if (!S.open || r.meta) continue;
      r.meta = await readMeta(r.entry.file).catch(() => ({ width: 0, height: 0, duration: 0 }));
      r.thumb = r.meta.thumb || null;
      if (r.kindAuto) r.kind = A.autoKind(r.meta);
      renderRow(r); renderIssues(); renderSend();
    }
  }
  function readMeta(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      const done = (val, err) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); err ? reject(err) : resolve(val); };
      const timer = setTimeout(() => done(null, new Error('tempo esgotado')), 15000);
      v.onerror = () => done(null, new Error('não decodifica'));
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
      v.onseeked = () => {
        const meta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
        try {
          const c = document.createElement('canvas'); const k = 160 / Math.max(v.videoWidth, v.videoHeight, 1);
          c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          meta.thumb = c.toDataURL('image/jpeg', 0.7);
        } catch (e) { /* sem miniatura */ }
        done(meta);
      };
    });
  }

  // ---------- conexão ----------

  async function connect(useMock) {
    S.connecting = true; S.connectError = ''; renderConnect();
    try {
      S.engine = useMock ? FacebookPages.mock() : FacebookPages.real(configAppId(), configLoginId());
      S.user = await S.engine.connect();
      S.pages = (await S.engine.pages()).filter((p) => p.canPost !== false);
      if (!S.pages.length) throw new Error('Nenhuma Página encontrada nesta conta. É preciso ser administrador(a) de uma Página do Facebook.');
      S.pageId = store.get('pageId', null);
      if (!S.pages.some((p) => p.id === S.pageId)) S.pageId = S.pages[0].id;
    } catch (e) {
      S.engine = null; S.user = null; S.pages = [];
      S.connectError = e.message || String(e);
    }
    S.connecting = false; renderConnect(); renderSend();
  }
  function disconnect() {
    if (S.sending) return;
    if (S.engine) S.engine.disconnect();
    S.engine = null; S.user = null; S.pages = []; S.pageId = null;
    renderConnect(); renderSend();
  }
  const currentPage = () => S.pages.find((p) => p.id === S.pageId);

  function renderConnect() {
    const el = $('schedConnect');
    const appId = configAppId();
    let html = '<div class="fc-top"><span class="tile" style="--tile: var(--purple)"><svg class="ic"><use href="#i-link"/></svg></span>' +
      '<div class="fc-info"><h3>1. Conectar a Página</h3>';
    if (S.connecting) {
      html += '<span class="sub">Conectando…</span></div></div>';
    } else if (S.user) {
      const sim = S.engine.kind === 'mock';
      html += '<span class="sub">Conectado como <b>' + esc(S.user.name) + '</b>' + (sim ? ' <span class="chip">simulação</span>' : '') + '</span></div>' +
        '<button class="btn small" data-sact="logout" type="button"' + (S.sending ? ' disabled' : '') + '>Sair</button></div>' +
        '<label class="field"><span>Publicar na Página</span><select id="schedPage"' + (S.sending ? ' disabled' : '') + '>' +
        S.pages.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pageId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
        (sim ? '<p class="fc-note">Modo simulação: nada é enviado de verdade. Serve para testar a tela. Para publicar, saia e entre com o Facebook.</p>' : '');
    } else {
      html += '<span class="sub">Os vídeos são publicados numa Página do Facebook da qual você é administrador(a).</span></div></div>' +
        '<div class="fc-actions">' +
        '<button class="btn primary" data-sact="login" type="button"' + (appId ? '' : ' disabled') + '><svg class="ic sm"><use href="#i-facebook"/></svg> Entrar com Facebook</button>' +
        '<button class="btn small" data-sact="mock" type="button">Testar no modo simulação</button></div>' +
        (appId ? '' : '<p class="fc-note">Para entrar com o Facebook, falta configurar o <b>App ID</b> (veja abaixo). Enquanto isso, dá para testar tudo no modo simulação.</p>') +
        '<details class="fc-details"><summary>Configurar App ID</summary><div class="appid">' +
        '<p class="sub">Número público do app criado em developers.facebook.com (com o domínio <code>' + esc(location.hostname || 'ast1500.github.io') + '</code> autorizado). Fica salvo só neste navegador.</p>' +
        '<label class="field"><span>ID do app</span><input type="text" inputmode="numeric" id="schedAppId" placeholder="Ex.: 123456789012345" value="' + esc(store.get('appId', '')) + '"></label>' +
        '<label class="field"><span>ID da configuração <small class="sub">(do "Login do Facebook para Empresas")</small></span><input type="text" inputmode="numeric" id="schedConfigId" placeholder="Ex.: 987654321098765" value="' + esc(store.get('configId', '')) + '"></label>' +
        '<button class="btn small" data-sact="saveappid" type="button">Salvar</button></div></details>';
      if (S.connectError) html += '<p class="fc-note err">' + esc(S.connectError) + '</p>';
    }
    html += '<p class="sub privacy">🔒 O login do Facebook só é carregado quando você toca em "Entrar". A limpeza continua 100% no seu aparelho; só os vídeos que você agendar são enviados, já limpos, para o Facebook.</p>';
    el.innerHTML = html;
  }

  // ---------- ferramentas em massa ----------

  const targets = () => { const sel = S.rows.filter((r) => r.selected && r.status !== 'scheduled'); return sel.length ? sel : S.rows.filter((r) => r.status !== 'scheduled'); };
  function scopeLabel() {
    const sel = S.rows.filter((r) => r.selected).length;
    $('schedScope').textContent = sel ? 'As ações abaixo valem para os ' + sel + ' vídeo(s) selecionado(s).' : 'As ações abaixo valem para todos os ' + S.rows.length + ' vídeo(s) (ou selecione alguns na lista).';
  }

  function applyCaption() {
    const tpl = $('tTemplate').value, tTitle = $('tTitle').value;
    store.set('template', tpl); store.set('titleTpl', tTitle);
    const list = targets();
    list.forEach((r, i) => {
      const ctx = { n: i + 1, total: list.length, nome: r.name, when: r.when };
      if (tpl.trim()) r.caption = A.applyTemplate(tpl, ctx);
      if (tTitle.trim()) r.title = A.applyTemplate(tTitle, ctx);
    });
    renderRows(); toast('Legenda aplicada em ' + list.length + ' vídeo(s).');
  }
  function applyTags() {
    const tags = A.normalizeHashtags($('tTags').value);
    const mode = $('tTagMode').value;
    const list = targets();
    list.forEach((r) => { r.hashtags = (mode === 'add' ? A.normalizeHashtags(r.hashtags + ' ' + tags.join(' ')) : tags).join(' '); });
    store.set('tags', $('tTags').value);
    renderRows(); toast('Hashtags aplicadas em ' + list.length + ' vídeo(s).');
  }
  function saveTagSet() {
    const tags = A.normalizeHashtags($('tTags').value);
    const name = $('tSetName').value.trim();
    if (!tags.length) return toast('Escreva as hashtags primeiro.', true);
    if (!name) { $('tSetName').focus(); return toast('Dê um nome ao conjunto (ex.: Viagem).', true); }
    const sets = store.get('sets', []).filter((s) => s.name.toLowerCase() !== name.toLowerCase());
    sets.push({ name, tags: tags.join(' ') }); store.set('sets', sets);
    $('tSetName').value = ''; renderSets(); toast('Conjunto "' + name + '" salvo.');
  }
  function renderSets() {
    const sets = store.get('sets', []);
    $('tSets').innerHTML = sets.length ? sets.map((s, i) => '<span class="tagset"><button type="button" data-set="' + i + '" title="' + esc(s.tags) + '">' + esc(s.name) + '</button>' +
      '<button type="button" class="x" data-delset="' + i + '" aria-label="Apagar conjunto">×</button></span>').join('') : '<span class="sub">Nenhum conjunto salvo ainda.</span>';
  }
  function applyDates() {
    const start = $('tStart').value ? new Date($('tStart').value + 'T00:00') : new Date();
    const times = A.parseTimes($('tTimes').value);
    const days = [...$('tDays').querySelectorAll('button.on')].map((b) => +b.dataset.d);
    if (!times.length) return toast('Escreva pelo menos um horário, como 12:00.', true);
    if (!days.length) return toast('Escolha pelo menos um dia da semana.', true);
    store.set('times', $('tTimes').value); store.set('days', days);
    const list = targets();
    const dates = A.distribute(list.length, { start, times, weekdays: days });
    list.forEach((r, i) => { r.when = dates[i] || null; });
    renderRows();
    if (dates.length) toast(list.length + ' vídeo(s) distribuídos de ' + A.fmtDate(dates[0]) + ' até ' + A.fmtDate(dates[dates.length - 1]) + '.');
  }
  function applyKind() {
    const v = $('tKind').value;
    targets().forEach((r) => { r.kindAuto = v === 'auto'; r.kind = v === 'auto' ? A.autoKind(r.meta) : v; });
    renderRows();
  }

  function importCsv(text) {
    const changes = A.csvToChanges(text);
    let hit = 0;
    for (const r of S.rows) {
      const ch = changes.get(r.name.toLowerCase());
      if (!ch || r.status === 'scheduled') continue;
      if (ch.kind) { r.kind = ch.kind; r.kindAuto = false; }
      if (ch.title !== undefined) r.title = ch.title;
      if (ch.caption !== undefined) r.caption = ch.caption;
      if (ch.hashtags !== undefined) r.hashtags = ch.hashtags;
      if (ch.when) r.when = ch.when;
      hit++;
    }
    renderRows();
    toast(hit ? 'Planilha aplicada em ' + hit + ' vídeo(s).' + (changes.size > hit ? ' ' + (changes.size - hit) + ' linha(s) não bateram com nenhum arquivo.' : '') : 'Nenhuma linha da planilha bateu com os nomes dos arquivos.', !hit);
  }
  function exportCsv() {
    const blob = new Blob([A.toCSV(S.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'agenda-videos.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ---------- fila ----------

  function rowIssues(r) { return r.status === 'scheduled' ? [] : A.validate(r, new Date(), S.rows).concat(r.note ? [{ level: 'warn', msg: r.note }] : []); }

  function rowHtml(r) {
    const done = r.status === 'scheduled', busy = r.status === 'uploading';
    const lock = done || busy || S.sending ? ' disabled' : '';
    const meta = r.meta && r.meta.width ? fmtDur(r.meta.duration) + ' · ' + r.meta.width + '×' + r.meta.height + ' · ' : '';
    const tags = A.normalizeHashtags(r.hashtags).length;
    let status = '';
    if (busy) status = '<div class="progress"><div style="width:' + Math.round(r.progress * 100) + '%"></div></div><span class="sub">Enviando… ' + Math.round(r.progress * 100) + '%</span>';
    else if (done) status = '<p class="srow-ok">✓ Agendado para ' + esc(fmtWhen(r.when)) + (r.result && r.result.url ? ' · <a href="' + esc(r.result.url) + '" target="_blank" rel="noopener">ver</a>' : '') + '</p>';
    else if (r.status === 'error') status = '<p class="fc-note err">' + esc(r.error) + '</p><button class="btn small" type="button" data-retry="' + r.id + '">Tentar de novo</button>';
    return '<article class="srow s-' + r.status + '" data-rid="' + r.id + '">' +
      '<label class="srow-check" title="Selecionar"><input type="checkbox" data-f="selected"' + (r.selected ? ' checked' : '') + (done ? ' disabled' : '') + '></label>' +
      '<div class="srow-thumb' + (r.kind === 'reel' ? ' reel' : '') + '">' + (r.thumb ? '<img alt="" src="' + r.thumb + '">' : '<svg class="ic"><use href="#i-film"/></svg>') + '</div>' +
      '<div class="srow-main">' +
        '<div class="srow-top"><b class="srow-name" title="' + esc(r.name) + '">' + r.n + '. ' + esc(r.name) + '</b><span class="sub">' + meta + fmtSize(r.size) + '</span></div>' +
        '<div class="srow-grid">' +
          '<select data-f="kind"' + lock + ' aria-label="Tipo"><option value="video"' + (r.kind === 'video' ? ' selected' : '') + '>Vídeo</option><option value="reel"' + (r.kind === 'reel' ? ' selected' : '') + '>Reel</option></select>' +
          '<input type="datetime-local" data-f="when" value="' + A.toLocalInput(r.when) + '"' + lock + ' aria-label="Data e hora">' +
          '<input type="text" data-f="title" class="wide" placeholder="Título (opcional)" value="' + esc(r.title) + '"' + lock + '>' +
          '<textarea data-f="caption" class="wide" rows="2" placeholder="Legenda"' + lock + '>' + esc(r.caption) + '</textarea>' +
          '<div class="wide tagline"><input type="text" data-f="hashtags" placeholder="#hashtags" value="' + esc(r.hashtags) + '"' + lock + '><span class="tagcount' + (tags > A.HASHTAG_SOFT_LIMIT ? ' over' : '') + '">' + tags + '</span></div>' +
        '</div>' +
        '<ul class="srow-issues"></ul>' + status +
      '</div></article>';
  }
  function renderRow(r) {
    const old = document.querySelector('.srow[data-rid="' + r.id + '"]');
    if (!old) return;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHtml(r);
    old.replaceWith(tmp.firstElementChild);
    renderIssues();
  }
  function renderRows() {
    $('schedRows').innerHTML = S.rows.map(rowHtml).join('');
    renderIssues(); renderSend(); scopeLabel();
    $('schedAll').checked = S.rows.length > 0 && S.rows.every((r) => r.selected || r.status === 'scheduled');
  }
  function renderIssues() {
    for (const r of S.rows) {
      const ul = document.querySelector('.srow[data-rid="' + r.id + '"] .srow-issues');
      if (!ul) continue;
      ul.innerHTML = rowIssues(r).map((i) => '<li class="' + i.level + '">' + (i.level === 'error' ? '⛔ ' : '⚠️ ') + esc(i.msg) + '</li>').join('');
    }
  }

  // ---------- envio ----------

  function readyRows() { return S.rows.filter((r) => r.status !== 'scheduled' && !rowIssues(r).some((i) => i.level === 'error')); }

  function renderSend() {
    const el = $('schedSend'); if (!el) return;
    const total = S.rows.length;
    const scheduled = S.rows.filter((r) => r.status === 'scheduled').length;
    const errors = S.rows.filter((r) => r.status !== 'scheduled' && rowIssues(r).some((i) => i.level === 'error')).length;
    const ready = readyRows().length;
    let html = '<div class="fc-top"><span class="tile" style="--tile: var(--green)"><svg class="ic"><use href="#i-calendar"/></svg></span><div class="fc-info"><h3>4. Agendar</h3>' +
      '<div class="chips"><span class="chip ok">' + ready + ' pronto(s)</span>' + (errors ? '<span class="chip hot">' + errors + ' com problema</span>' : '') +
      (scheduled ? '<span class="chip">' + scheduled + ' de ' + total + ' agendado(s)</span>' : '') + '</div></div></div>';
    if (S.sending) {
      const doneNow = S.rows.filter((r) => r.status === 'scheduled').length;
      html += '<div class="fc-actions"><div class="progress"><div style="width:' + Math.round(doneNow / Math.max(1, S.sendTotal) * 100) + '%"></div></div>' +
        '<span class="sub">Enviando ' + Math.min(S.sendIndex + 1, S.sendTotal) + ' de ' + S.sendTotal + '. Mantenha esta aba aberta até terminar.</span>' +
        '<button class="btn small" data-sact="cancel" type="button">Cancelar</button></div>';
    } else {
      const need = !S.user ? 'Conecte a Página (passo 1) para agendar.' : '';
      html += '<div class="fc-actions"><button class="btn primary wide" data-sact="send" type="button"' + (!S.user || !ready ? ' disabled' : '') + '>' +
        '<svg class="ic sm"><use href="#i-calendar"/></svg> Agendar ' + ready + ' vídeo(s)' + (currentPage() ? ' em ' + esc(currentPage().name) : '') + '</button></div>' +
        (need ? '<p class="sub">' + need + '</p>' : '') +
        (scheduled && S.engine && S.engine.plannerUrl ? '<p class="sub">Veja e edite os agendamentos no <a href="' + S.engine.plannerUrl + '" target="_blank" rel="noopener">Meta Business Suite → Planejador</a>.</p>' : '') +
        (scheduled && S.engine && S.engine.kind === 'mock' ? '<p class="sub">Simulação: nada foi enviado de verdade.</p>' : '') +
        '<p class="sub">Depois que um vídeo aparece como "Agendado", ele já está guardado no Facebook: pode fechar a página que a publicação acontece na hora marcada.</p>';
    }
    el.innerHTML = html;
  }

  async function sendOne(r, page) {
    r.status = 'uploading'; r.progress = 0; r.error = ''; renderRow(r);
    let last = 0;
    try {
      const blob = await r.entry.getBlob(); // vídeo já limpo (limpa agora se ainda não estava)
      r.result = await S.engine.upload({
        page, blob, kind: r.kind, title: r.title.trim(), description: A.buildDescription(r.caption, r.hashtags), when: r.when,
        signal: S.controller.signal,
        onProgress: (p) => { r.progress = p; if (Date.now() - last > 250) { last = Date.now(); renderRow(r); } },
      });
      r.status = 'scheduled';
    } catch (e) {
      r.status = e.code === 'abort' ? 'pending' : 'error';
      r.error = e.message || String(e);
      if (e.code === 190) throw e; // sessão expirou: para a fila
    } finally { renderRow(r); renderSend(); }
  }

  async function sendAll(only) {
    const page = currentPage();
    if (!page || S.sending) return;
    const queue = only ? [only] : readyRows();
    if (!queue.length) return;
    S.sending = true; S.controller = new AbortController(); S.sendTotal = queue.length; S.sendIndex = 0;
    renderRows(); renderConnect();
    try {
      for (let i = 0; i < queue.length && !S.controller.signal.aborted; i++) { S.sendIndex = i; renderSend(); await sendOne(queue[i], page); }
    } catch (e) {
      toast(e.message, true); disconnect();
    }
    const cancelled = S.controller.signal.aborted;
    S.sending = false; S.controller = null;
    renderRows(); renderConnect();
    const ok = queue.filter((r) => r.status === 'scheduled').length, bad = queue.filter((r) => r.status === 'error').length;
    toast(cancelled ? 'Envio cancelado. ' + ok + ' vídeo(s) já tinham sido agendados.' : ok + ' vídeo(s) agendado(s).' + (bad ? ' ' + bad + ' com erro: veja na lista.' : ''), bad > 0 && !ok);
  }

  window.addEventListener('beforeunload', (e) => { if (S.sending) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- montar a tela ----------

  function renderAll() {
    $('schedSub').textContent = S.rows.length + ' vídeo(s) de "' + S.title + '"' + (S.hidden.length ? ' · ' + S.hidden.length + ' não entram (formato não suportado ou erro)' : '');
    $('tTemplate').value = store.get('template', '');
    $('tTitle').value = store.get('titleTpl', '');
    $('tTags').value = store.get('tags', '');
    $('tTimes').value = store.get('times', '12:00, 19:00');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    $('tStart').value = A.toLocalInput(tomorrow).slice(0, 10);
    const days = store.get('days', [0, 1, 2, 3, 4, 5, 6]);
    $('tDays').innerHTML = WEEK.map((l, d) => '<button type="button" data-d="' + d + '" title="' + WEEK_FULL[d] + '" class="' + (days.includes(d) ? 'on' : '') + '">' + l + '</button>').join('');
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* sem fuso */ }
    $('tTz').textContent = tz ? 'Horários no fuso deste aparelho (' + tz + ').' : '';
    renderSets(); renderConnect(); renderRows();
  }

  function bind() {
    $('schedBack').addEventListener('click', close);
    $('scheduler').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sact]');
      if (b) {
        const act = b.dataset.sact;
        if (act === 'login') connect(false);
        else if (act === 'mock') connect(true);
        else if (act === 'logout') disconnect();
        else if (act === 'send') sendAll();
        else if (act === 'cancel' && S.controller) S.controller.abort();
        else if (act === 'saveappid') {
          const v = $('schedAppId').value.replace(/\D/g, '');
          const c = $('schedConfigId').value.replace(/\D/g, '');
          store.set('appId', v); store.set('configId', c); renderConnect();
          toast(v ? 'Salvo neste navegador.' + (c ? '' : ' Se o app usa "Login do Facebook para Empresas", preencha também o ID da configuração.') : 'App ID removido.');
        }
        return;
      }
      const retry = e.target.closest('[data-retry]');
      if (retry) { const r = S.rows.find((x) => x.id === +retry.dataset.retry); if (r) sendAll(r); }
      const set = e.target.closest('[data-set]');
      if (set) { const s = store.get('sets', [])[+set.dataset.set]; if (s) { $('tTags').value = s.tags; } }
      const del = e.target.closest('[data-delset]');
      if (del) { const sets = store.get('sets', []); sets.splice(+del.dataset.delset, 1); store.set('sets', sets); renderSets(); }
      const day = e.target.closest('#tDays button');
      if (day) day.classList.toggle('on');
    });
    $('scheduler').addEventListener('change', (e) => {
      if (e.target.id === 'schedPage') { S.pageId = e.target.value; store.set('pageId', S.pageId); renderSend(); }
    });
    $('tApplyCaption').addEventListener('click', applyCaption);
    $('tApplyTags').addEventListener('click', applyTags);
    $('tSaveSet').addEventListener('click', saveTagSet);
    $('tApplyDates').addEventListener('click', applyDates);
    $('tApplyKind').addEventListener('click', applyKind);
    $('tCsvExport').addEventListener('click', exportCsv);
    $('tCsvImport').addEventListener('click', () => $('tCsvFile').click());
    $('tCsvFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(await f.text()); });
    $('schedAll').addEventListener('change', (e) => { S.rows.forEach((r) => { if (r.status !== 'scheduled') r.selected = e.target.checked; }); renderRows(); });

    const rows = $('schedRows');
    const update = (e) => {
      const el = e.target, f = el.dataset.f; if (!f) return;
      const r = S.rows.find((x) => x.id === +el.closest('.srow').dataset.rid); if (!r) return;
      if (f === 'selected') { r.selected = el.checked; scopeLabel(); return; }
      if (f === 'when') r.when = A.fromLocalInput(el.value);
      else if (f === 'kind') { r.kind = el.value; r.kindAuto = false; el.closest('.srow').querySelector('.srow-thumb').classList.toggle('reel', r.kind === 'reel'); }
      else r[f] = el.value;
      if (f === 'hashtags') { const c = el.parentElement.querySelector('.tagcount'); const n = A.normalizeHashtags(r.hashtags).length; c.textContent = n; c.classList.toggle('over', n > A.HASHTAG_SOFT_LIMIT); }
      renderIssues(); renderSend();
    };
    rows.addEventListener('input', update);
    rows.addEventListener('change', update);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  window.Scheduler = { open, close, _state: S };
})();
