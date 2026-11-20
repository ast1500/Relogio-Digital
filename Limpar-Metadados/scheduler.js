/*
 * scheduler.js — tela "Agendar no Facebook", organizada em etapas:
 *   1. Conectar a Página  2. Legendas (lista para sortear)  3. Hashtags (lista para sortear)
 *   4. Horários (passos de 10 minutos)  5. Revisar cada post (com 🎲 por post)  6. Agendar
 * Depende de: schedule.js (Agenda) e facebook.js (FacebookPages).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const A = window.Agenda;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- preferências (só neste navegador) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vl-agenda-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vl-agenda-' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };
  // Os números do config.js têm prioridade; o que for digitado na tela só vale se o site não tiver um configurado.
  const cfg = () => window.VIDEO_LIMPO_CONFIG || {};
  const configAppId = () => cfg().facebookAppId || store.get('appId', '');
  const configLoginId = () => cfg().facebookConfigId || store.get('configId', '');
  const builtInIds = () => !!cfg().facebookAppId;

  const S = {
    open: false, title: '', rows: [], hidden: [],
    engine: null, user: null, pages: [], pageId: null, connecting: false, connectError: '',
    sending: false, controller: null, sendTotal: 0, sendIndex: 0,
  };
  let nextRow = 1;

  const fmtSize = (b) => { const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i]; };
  const fmtDur = (s) => { if (!s || !isFinite(s)) return ''; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtWhen = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' às ' + A.fmtTime(d);
  const toast = (m, e) => window.VideoLimpoToast && window.VideoLimpoToast(m, e);

  // ---------- listas (legendas e hashtags) ----------
  const captionPool = () => A.parseCaptionPool($('capPool').value);
  const fillCaption = (text, r) => A.applyTemplate(text, { n: r.n, total: S.rows.length, nome: r.name, when: r.when });
  const tagSettings = () => ({ pool: $('tagPool').value, per: +$('tagPer').value, fixed: $('tagFixed').value });

  function updatePoolInfo() {
    const caps = captionPool().length;
    $('capCount').textContent = caps ? caps + (caps === 1 ? ' legenda na lista' : ' legendas na lista') : 'Nenhuma legenda na lista';
    const tags = A.normalizeHashtags($('tagPool').value).length;
    const fixed = A.normalizeHashtags($('tagFixed').value).length;
    $('tagCount').textContent = (tags ? tags + ' hashtag(s) na lista' : 'Nenhuma hashtag na lista') + (fixed ? ' · ' + fixed + ' fixa(s)' : '');
  }
  function savePools() {
    store.set('capPool', $('capPool').value); store.set('tagPool', $('tagPool').value);
    store.set('tagPer', $('tagPer').value); store.set('tagFixed', $('tagFixed').value);
  }

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
    initForm();
    // Já sugere os horários (a partir do próximo horário livre, a cada X minutos)
    applyDates(true);
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

  // ---------- 1. conexão ----------

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
    let html = '<div class="step-head"><span class="tile" style="--tile: var(--purple)"><svg class="ic"><use href="#i-link"/></svg></span><div><h3>1. Conectar a Página</h3>';
    if (S.connecting) {
      html += '<span class="sub">Conectando…</span></div></div>';
    } else if (S.user) {
      const sim = S.engine.kind === 'mock';
      html += '<span class="sub">Conectado como <b>' + esc(S.user.name) + '</b>' + (sim ? ' <span class="chip">simulação</span>' : '') + '</span></div>' +
        '<button class="btn small push" data-sact="logout" type="button"' + (S.sending ? ' disabled' : '') + '>Sair</button></div>' +
        '<label class="field"><span>Publicar na Página</span><select id="schedPage"' + (S.sending ? ' disabled' : '') + '>' +
        S.pages.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === S.pageId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
        (sim ? '<p class="fc-note">Modo simulação: nada é enviado de verdade. Para publicar, toque em Sair e entre com o Facebook.</p>' : '');
    } else {
      html += '<span class="sub">Escolha a Página do Facebook onde os vídeos serão publicados.</span></div></div>' +
        '<div class="btn-row">' +
        '<button class="btn primary" data-sact="login" type="button"' + (appId ? '' : ' disabled') + '><svg class="ic sm"><use href="#i-facebook"/></svg> Entrar com Facebook</button>' +
        '<button class="btn" data-sact="mock" type="button">Testar no modo simulação</button></div>' +
        (appId ? '' : '<p class="fc-note">Falta configurar o <b>App ID</b> do Facebook (abaixo). Enquanto isso, dá para testar no modo simulação.</p>') +
        '<details class="howto"' + (builtInIds() ? ' hidden' : '') + '><summary>Configurar App ID</summary><div class="appid">' +
        '<label class="field"><span>ID do app</span><input type="text" inputmode="numeric" id="schedAppId" value="' + esc(store.get('appId', '')) + '"></label>' +
        '<label class="field"><span>ID da configuração (Login para Empresas)</span><input type="text" inputmode="numeric" id="schedConfigId" value="' + esc(store.get('configId', '')) + '"></label>' +
        '<button class="btn small" data-sact="saveappid" type="button">Salvar</button></div></details>';
      if (S.connectError) html += '<p class="fc-note err">' + esc(S.connectError) + '</p>';
    }
    html += '<p class="sub">🔒 O login do Facebook só é carregado quando você toca em "Entrar". Só os vídeos que você agendar são enviados, já limpos.</p>';
    el.innerHTML = html;
  }

  // ---------- 2–4. ações em massa ----------

  const pending = () => S.rows.filter((r) => r.status !== 'scheduled');
  const targets = () => { const sel = pending().filter((r) => r.selected); return sel.length ? sel : pending(); };
  function scopeLabel() {
    const sel = S.rows.filter((r) => r.selected && r.status !== 'scheduled').length;
    $('schedScope').innerHTML = sel
      ? '👉 As ações dos passos 2 a 4 valem para os <b>' + sel + ' post(s) selecionado(s)</b> no passo 5.'
      : '👉 As ações dos passos 2 a 4 valem para <b>todos os ' + pending().length + ' post(s)</b>. Para mudar só alguns, selecione-os no passo 5.';
  }

  function shuffleCaptions() {
    const pool = captionPool();
    if (!pool.length) return toast('Escreva as legendas na lista primeiro (uma por linha).', true);
    const list = targets(); const picks = A.drawMany(pool, list.length);
    list.forEach((r, i) => { r.caption = fillCaption(picks[i], r); });
    savePools(); renderRows(); toast('Legendas sorteadas para ' + list.length + ' post(s).');
  }
  function orderCaptions() {
    const pool = captionPool();
    if (!pool.length) return toast('Escreva as legendas na lista primeiro (uma por linha).', true);
    const list = targets();
    list.forEach((r, i) => { r.caption = fillCaption(pool[i % pool.length], r); });
    savePools(); renderRows(); toast('Legendas aplicadas na ordem da lista.');
  }
  function shuffleTags() {
    const t = tagSettings();
    if (!A.normalizeHashtags(t.pool).length && !A.normalizeHashtags(t.fixed).length) return toast('Escreva as hashtags na lista primeiro.', true);
    const list = targets();
    list.forEach((r) => { r.hashtags = A.pickHashtags(t.pool, t.per, t.fixed); });
    savePools(); renderRows(); toast('Hashtags sorteadas para ' + list.length + ' post(s).');
  }
  function clearTags() { targets().forEach((r) => { r.hashtags = ''; }); renderRows(); }

  function firstSlot() {
    const v = A.fromLocalInput($('tFirst').value);
    const min = A.nextSlot();
    return v && v >= new Date(Date.now() + A.MIN_LEAD_MIN * 60000) ? A.roundTo10(v) : min;
  }
  function applyDates(silent) {
    const first = firstSlot(), minutes = +$('tInterval').value;
    $('tFirst').value = A.toLocalInput(first);
    store.set('interval', String(minutes));
    const list = silent ? pending() : targets();
    const dates = A.distributeInterval(list.length, first, minutes);
    list.forEach((r, i) => { r.when = dates[i]; });
    updateTimesInfo(dates);
    if (!silent) { renderRows(); toast(list.length + ' horário(s) distribuídos.'); }
  }
  function updateTimesInfo(dates) {
    const all = (dates || S.rows.map((r) => r.when)).filter(Boolean).sort((a, b) => a - b);
    $('timesInfo').textContent = all.length ? 'De ' + fmtWhen(all[0]) + ' até ' + fmtWhen(all[all.length - 1]) : 'Escolha o primeiro horário e o intervalo';
  }
  function applyKind() {
    const v = $('tKind').value;
    targets().forEach((r) => { r.kindAuto = v === 'auto'; r.kind = v === 'auto' ? A.autoKind(r.meta) : v; });
    renderRows();
  }
  function applyTitle() {
    const tpl = $('tTitle').value; store.set('titleTpl', tpl);
    targets().forEach((r) => { r.title = A.applyTemplate(tpl, { n: r.n, total: S.rows.length, nome: r.name, when: r.when }); });
    toast(tpl.trim() ? 'Título aplicado.' : 'Títulos removidos.');
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
      if (ch.when) r.when = A.roundTo10(ch.when);
      hit++;
    }
    renderRows();
    toast(hit ? 'Planilha aplicada em ' + hit + ' post(s).' : 'Nenhuma linha da planilha bateu com os nomes dos arquivos.', !hit);
  }
  function exportCsv() {
    const blob = new Blob([A.toCSV(S.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'agenda-videos.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ---------- 5. revisar ----------

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
      '<div class="srow-side">' +
        '<label class="srow-check" title="Selecionar"><input type="checkbox" data-f="selected"' + (r.selected ? ' checked' : '') + (done ? ' disabled' : '') + '></label>' +
        '<div class="srow-thumb' + (r.kind === 'reel' ? ' reel' : '') + '">' + (r.thumb ? '<img alt="" src="' + r.thumb + '">' : '<svg class="ic"><use href="#i-film"/></svg>') + '</div>' +
      '</div>' +
      '<div class="srow-main">' +
        '<div class="srow-top"><b class="srow-name" title="' + esc(r.name) + '">' + r.n + '. ' + esc(r.name) + '</b><span class="sub">' + meta + fmtSize(r.size) + '</span></div>' +
        '<div class="srow-when">' +
          '<select data-f="kind"' + lock + ' aria-label="Tipo"><option value="video"' + (r.kind === 'video' ? ' selected' : '') + '>Vídeo</option><option value="reel"' + (r.kind === 'reel' ? ' selected' : '') + '>Reel</option></select>' +
          '<input type="datetime-local" step="600" data-f="when" value="' + A.toLocalInput(r.when) + '"' + lock + ' aria-label="Data e hora">' +
        '</div>' +
        '<div class="with-dice"><textarea data-f="caption" rows="2" placeholder="Legenda"' + lock + '>' + esc(r.caption) + '</textarea>' +
          '<button type="button" class="dice" data-dice="caption" title="Sortear outra legenda" aria-label="Sortear outra legenda"' + lock + '>🎲</button></div>' +
        '<div class="with-dice"><input type="text" data-f="hashtags" placeholder="#hashtags" value="' + esc(r.hashtags) + '"' + lock + '>' +
          '<span class="tagcount' + (tags > A.HASHTAG_SOFT_LIMIT ? ' over' : '') + '" title="Hashtags">' + tags + '</span>' +
          '<button type="button" class="dice" data-dice="hashtags" title="Sortear outras hashtags" aria-label="Sortear outras hashtags"' + lock + '>🎲</button></div>' +
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
    renderIssues(); renderSend(); scopeLabel(); updateTimesInfo();
    $('schedAll').checked = S.rows.length > 0 && pending().length > 0 && pending().every((r) => r.selected);
  }
  function renderIssues() {
    for (const r of S.rows) {
      const ul = document.querySelector('.srow[data-rid="' + r.id + '"] .srow-issues');
      if (!ul) continue;
      ul.innerHTML = rowIssues(r).map((i) => '<li class="' + i.level + '">' + (i.level === 'error' ? '⛔ ' : '⚠️ ') + esc(i.msg) + '</li>').join('');
    }
  }

  function rerollRow(r, what) {
    if (what === 'caption') {
      const pool = captionPool();
      if (!pool.length) return toast('Adicione legendas na lista do passo 2.', true);
      const currentRaw = pool.find((p) => fillCaption(p, r) === r.caption);
      r.caption = fillCaption(A.drawOther(pool, currentRaw), r);
    } else {
      const t = tagSettings();
      if (!A.normalizeHashtags(t.pool).length && !A.normalizeHashtags(t.fixed).length) return toast('Adicione hashtags na lista do passo 3.', true);
      let next = A.pickHashtags(t.pool, t.per, t.fixed);
      for (let i = 0; i < 5 && next === r.hashtags; i++) next = A.pickHashtags(t.pool, t.per, t.fixed);
      r.hashtags = next;
    }
    renderRow(r); renderSend();
  }

  // ---------- 6. agendar ----------

  function readyRows() { return S.rows.filter((r) => r.status !== 'scheduled' && !rowIssues(r).some((i) => i.level === 'error')); }

  function renderSend() {
    const el = $('schedSend'); if (!el) return;
    const total = S.rows.length;
    const scheduled = S.rows.filter((r) => r.status === 'scheduled').length;
    const errors = S.rows.filter((r) => r.status !== 'scheduled' && rowIssues(r).some((i) => i.level === 'error')).length;
    const ready = readyRows().length;
    let html = '<div class="step-head"><span class="tile" style="--tile: var(--green)"><svg class="ic"><use href="#i-calendar"/></svg></span><div><h3>6. Agendar</h3>' +
      '<div class="chips"><span class="chip ok">' + ready + ' pronto(s)</span>' + (errors ? '<span class="chip hot">' + errors + ' com problema</span>' : '') +
      (scheduled ? '<span class="chip">' + scheduled + ' de ' + total + ' agendado(s)</span>' : '') + '</div></div></div>';
    if (S.sending) {
      const doneNow = S.rows.filter((r) => r.status === 'scheduled').length;
      html += '<div class="progress big"><div style="width:' + Math.round(doneNow / Math.max(1, S.sendTotal) * 100) + '%"></div></div>' +
        '<p class="sub">Enviando ' + Math.min(S.sendIndex + 1, S.sendTotal) + ' de ' + S.sendTotal + '. Mantenha esta aba aberta até terminar.</p>' +
        '<div class="btn-row"><button class="btn" data-sact="cancel" type="button">Cancelar envio</button></div>';
    } else {
      html += '<button class="btn primary wide" data-sact="send" type="button"' + (!S.user || !ready ? ' disabled' : '') + '>' +
        '<svg class="ic sm"><use href="#i-calendar"/></svg> Agendar ' + ready + ' post(s)' + (currentPage() ? ' em ' + esc(currentPage().name) : '') + '</button>' +
        (!S.user ? '<p class="sub">Conecte a Página (passo 1) para agendar.</p>' : '') +
        (scheduled && S.engine && S.engine.plannerUrl ? '<p class="sub">Veja e edite os agendamentos no <a href="' + S.engine.plannerUrl + '" target="_blank" rel="noopener">Meta Business Suite → Planejador</a>.</p>' : '') +
        (scheduled && S.engine && S.engine.kind === 'mock' ? '<p class="sub">Simulação: nada foi enviado de verdade.</p>' : '') +
        '<p class="sub">Quando um post aparece como "Agendado", ele já está guardado no Facebook: pode fechar a página.</p>';
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
      r.status = 'scheduled'; r.selected = false;
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
    } catch (e) { toast(e.message, true); disconnect(); }
    const cancelled = S.controller.signal.aborted;
    S.sending = false; S.controller = null;
    renderRows(); renderConnect();
    const ok = queue.filter((r) => r.status === 'scheduled').length, bad = queue.filter((r) => r.status === 'error').length;
    toast(cancelled ? 'Envio cancelado. ' + ok + ' post(s) já tinham sido agendados.' : ok + ' post(s) agendado(s).' + (bad ? ' ' + bad + ' com erro: veja na lista.' : ''), bad > 0 && !ok);
  }

  window.addEventListener('beforeunload', (e) => { if (S.sending) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- montar a tela ----------

  function initForm() {
    $('capPool').value = store.get('capPool', '');
    $('tagPool').value = store.get('tagPool', '');
    $('tagPer').value = store.get('tagPer', '3');
    $('tagFixed').value = store.get('tagFixed', '');
    $('tInterval').value = store.get('interval', '10');
    $('tTitle').value = store.get('titleTpl', '');
    $('tFirst').value = A.toLocalInput(A.nextSlot());
    $('tFirst').min = A.toLocalInput(A.nextSlot(new Date(Date.now() - 20 * 60000)));
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* sem fuso */ }
    $('tTz').textContent = 'Horários sempre em passos de 10 minutos' + (tz ? ', no fuso deste aparelho (' + tz + ').' : '.');
    updatePoolInfo();
  }
  function renderAll() {
    $('schedSub').textContent = S.rows.length + ' vídeo(s) de "' + S.title + '"' + (S.hidden.length ? ' · ' + S.hidden.length + ' não entram (formato não suportado ou erro)' : '');
    renderConnect(); renderRows();
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
          store.set('appId', $('schedAppId').value.replace(/\D/g, ''));
          store.set('configId', $('schedConfigId').value.replace(/\D/g, ''));
          renderConnect(); toast('Salvo neste navegador.');
        }
        return;
      }
      const retry = e.target.closest('[data-retry]');
      if (retry) { const r = S.rows.find((x) => x.id === +retry.dataset.retry); if (r) sendAll(r); return; }
      const dice = e.target.closest('[data-dice]');
      if (dice) { const r = S.rows.find((x) => x.id === +dice.closest('.srow').dataset.rid); if (r) rerollRow(r, dice.dataset.dice); return; }
      const step = e.target.closest('.steps a');
      if (step) { e.preventDefault(); const t = document.querySelector(step.getAttribute('href')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    $('scheduler').addEventListener('change', (e) => {
      if (e.target.id === 'schedPage') { S.pageId = e.target.value; store.set('pageId', S.pageId); renderSend(); }
    });
    $('capShuffle').addEventListener('click', shuffleCaptions);
    $('capOrder').addEventListener('click', orderCaptions);
    $('tagShuffle').addEventListener('click', shuffleTags);
    $('tagClear').addEventListener('click', clearTags);
    ['capPool', 'tagPool', 'tagFixed'].forEach((id) => $(id).addEventListener('input', () => { updatePoolInfo(); savePools(); }));
    $('tagPer').addEventListener('change', savePools);
    $('tFirst').addEventListener('change', () => { const d = A.fromLocalInput($('tFirst').value); if (d) $('tFirst').value = A.toLocalInput(A.roundTo10(d)); });
    $('tApplyDates').addEventListener('click', () => applyDates(false));
    $('tApplyKind').addEventListener('click', applyKind);
    $('tApplyTitle').addEventListener('click', applyTitle);
    $('tCsvExport').addEventListener('click', exportCsv);
    $('tCsvImport').addEventListener('click', () => $('tCsvFile').click());
    $('tCsvFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(await f.text()); });
    $('schedAll').addEventListener('change', (e) => { pending().forEach((r) => { r.selected = e.target.checked; }); renderRows(); });

    const rows = $('schedRows');
    const update = (e) => {
      const el = e.target, f = el.dataset.f; if (!f) return;
      const r = S.rows.find((x) => x.id === +el.closest('.srow').dataset.rid); if (!r) return;
      if (f === 'selected') { r.selected = el.checked; scopeLabel(); return; }
      if (f === 'when') {
        const d = A.fromLocalInput(el.value);
        r.when = d ? A.roundTo10(d) : null;
        if (e.type === 'change' && r.when) el.value = A.toLocalInput(r.when); // sempre em passos de 10 minutos
        updateTimesInfo();
      } else if (f === 'kind') {
        r.kind = el.value; r.kindAuto = false; el.closest('.srow').querySelector('.srow-thumb').classList.toggle('reel', r.kind === 'reel');
      } else r[f] = el.value;
      if (f === 'hashtags') { const c = el.parentElement.querySelector('.tagcount'); const n = A.normalizeHashtags(r.hashtags).length; c.textContent = n; c.classList.toggle('over', n > A.HASHTAG_SOFT_LIMIT); }
      renderIssues(); renderSend();
    };
    rows.addEventListener('input', update);
    rows.addEventListener('change', update);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  window.Scheduler = { open, close, _state: S };
})();
