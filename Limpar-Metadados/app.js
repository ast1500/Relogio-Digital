/* app.js — Vídeo Limpo: analisa e remove metadados de vídeos, tudo no navegador. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const items = [];          // { id, file, rel, group, result, status, error, progress, remaining, mode, out }
  const groups = [];         // pastas: { id, name, status, current, progress, allowDeep, zip, zipName, cancel }
  let nextId = 1, nextGroup = 1;
  const MAX_FOLDER = 100;
  const VIDEO_EXT = /\.(mp4|mov|m4v|3gp|3g2|webm|mkv|avi|mts|m2ts|wmv|flv|ogv|mpg|mpeg|hevc)$/i;
  const isVideo = (f) => f && f.size > 0 && !f.name.startsWith('.') && (VIDEO_EXT.test(f.name) || (f.type || '').startsWith('video/'));

  // ---------- utilidades ----------

  function fmtSize(bytes) {
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i];
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 4000);
  }
  window.VideoLimpoToast = toast;
  window.VideoLimpoRefresh = () => renderAll();
  let lastDownload = 0;
  function download(blob, name) {
    // espaça downloads seguidos para o navegador não bloquear
    const wait = Math.max(0, lastDownload + 600 - Date.now()); lastDownload = Date.now() + wait;
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }, wait);
  }
  const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  const useRandomNames = () => $('randomName').checked;
  function outputName(file, ext) {
    if (useRandomNames()) return 'video-' + randomHex() + ext;
    return file.name.replace(/\.[^.]+$/, '') + '-limpo' + ext;
  }
  const extOf = (file) => ((file.name.match(/\.[^.]+$/) || ['.mp4'])[0]).toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FORMAT_NAME = { mp4: 'MP4 / MOV', webm: 'WebM / MKV', unknown: 'formato desconhecido' };

  const CAT_STYLE = {
    'Localização': ['i-pin', 'var(--pink)'], 'Identificação': ['i-id', 'var(--pink)'],
    'Aparelho': ['i-phone', 'var(--purple)'], 'Data': ['i-calendar', 'var(--yellow)'],
    'Autoria': ['i-user', 'var(--sand)'], 'Software': ['i-code', 'var(--lime)'],
    'XMP': ['i-tag', 'var(--sand)'], 'Outros': ['i-tag', 'var(--gray)'],
  };
  const SEV_ORDER = { alta: 0, 'média': 1, baixa: 2 };

  // ---------- estado de cada arquivo ----------

  const needsDeep = (it) => it.result && (!it.result.cleanable || it.result.findings.some((f) => !f.removable));
  function riskColor(it) {
    if (it.status === 'done') return 'var(--green)';
    if (!it.result || it.result.format === 'unknown' || it.status === 'error') return 'var(--gray)';
    const f = it.result.findings;
    if (f.some((x) => x.severity === 'alta')) return 'var(--pink)';
    if (f.length) return 'var(--yellow)';
    return 'var(--green)';
  }

  function cardHtml(it) {
    const r = it.result, f = r ? r.findings : [];
    const high = f.filter((x) => x.severity === 'alta').length;
    let chips = '';
    if (it.status === 'analyzing') chips = '<span class="chip">analisando…</span>';
    else if (it.status === 'error') chips = '<span class="chip hot">erro</span>';
    else if (it.status === 'done') chips = '<span class="chip ok">✓ limpo' + (it.remaining ? ' · ' + it.remaining + ' restante(s)' : ' · 0 restantes') + '</span>';
    else if (r && r.format === 'unknown') chips = '<span class="chip">não analisado</span>';
    else if (r) {
      chips = f.length ? '<span class="chip">' + f.length + ' metadado(s)</span>' + (high ? '<span class="chip hot">' + high + ' sensível(is)</span>' : '')
        : '<span class="chip ok">nada encontrado</span>';
    }

    let rows = '';
    for (const x of f.slice().sort((p, q) => SEV_ORDER[p.severity] - SEV_ORDER[q.severity])) {
      const st = CAT_STYLE[x.category] || CAT_STYLE.Outros;
      rows += '<div class="meta-row"><span class="tile" style="--tile:' + st[1] + '"><svg class="ic"><use href="#' + st[0] + '"/></svg></span>' +
        '<div><div class="label">' + esc(x.label) + '</div><div class="value">' + esc(x.value) + '</div>' +
        '<div class="where">' + esc(x.category) + ' · ' + esc(x.where) + (x.removable ? '' : ' · só sai na limpeza profunda') + '</div></div>' +
        '<span class="sev ' + x.severity + '">' + x.severity + '</span></div>';
    }
    const details = f.length && it.status !== 'done'
      ? '<details class="fc-details"' + (items.length === 1 ? ' open' : '') + '><summary>Ver o que este vídeo revela</summary><div class="meta-list">' + rows + '</div></details>'
      : '';

    let note = '';
    if (it.status === 'error') note = '<p class="fc-note err">' + esc(it.error) + '</p>';
    else if (r && r.format === 'unknown') note = '<p class="fc-note">Formato não reconhecido para limpeza rápida. Use a limpeza profunda.</p>';
    else if (r && it.status !== 'done' && f.some((x) => !x.removable)) note = '<p class="fc-note">Este vídeo tem dados que a limpeza rápida não alcança. Use a limpeza profunda para remover tudo.</p>';
    else if (r && r.partial) note = '<p class="fc-note">Gravação ao vivo: só o começo do arquivo pode ter metadados, e ele foi analisado.</p>';

    let actions = '';
    const busy = it.status === 'cleaning';
    if (busy) {
      actions = '<div class="progress"><div style="width:' + Math.round((it.progress || 0) * 100) + '%"></div></div>' +
        '<span class="sub">' + (it.mode === 'deep' ? 'Limpeza profunda… ' + Math.round((it.progress || 0) * 100) + '% (mantenha a aba aberta)' : 'Limpando…') + '</span>' +
        (it.mode === 'deep' ? '<button class="btn small" data-act="cancel" type="button">Cancelar</button>' : '');
    } else if (r) {
      const quick = r.cleanable;
      if (it.status === 'done') actions += '<button class="btn small" data-act="' + (it.mode === 'deep' ? 'deep' : 'quick') + '" type="button"><svg class="ic sm"><use href="#i-download"/></svg> Baixar de novo</button>';
      else if (quick) actions += '<button class="btn green" data-act="quick" type="button"><svg class="ic sm"><use href="#i-bolt"/></svg> Baixar limpo</button>';
      if (it.status !== 'done' && (needsDeep(it) || !quick)) actions += '<button class="btn ' + (quick ? 'small' : 'primary') + '" data-act="deep" type="button"><svg class="ic sm"><use href="#i-refresh"/></svg> Limpeza profunda</button>';
      else if (it.status !== 'done' && quick) actions += '<button class="link-btn" data-act="deep" type="button">ou limpeza profunda</button>';
    }

    const color = riskColor(it);
    return '<article class="folder fcard" data-id="' + it.id + '" style="--tab:' + color + '">' +
      '<div class="fc-top"><span class="tile" style="--tile:' + color + '"><svg class="ic"><use href="#' + (it.status === 'done' ? 'i-check' : 'i-film') + '"/></svg></span>' +
      '<div class="fc-info"><h3>' + esc(it.file.name) + '</h3><span class="sub">' + fmtSize(it.file.size) + (r ? ' · ' + FORMAT_NAME[r.format] : '') + '</span>' +
      '<div class="chips">' + chips + '</div></div>' +
      (busy ? '' : '<button class="mini" data-act="remove" type="button" title="Tirar da lista" aria-label="Tirar da lista"><svg class="ic sm"><use href="#i-x"/></svg></button>') +
      '</div>' + details + note + (actions ? '<div class="fc-actions">' + actions + '</div>' : '') + '</article>';
  }

  function renderItem(it) {
    if (it.group) return renderGroup(groups.find((g) => g.id === it.group));
    const old = document.querySelector('.fcard[data-id="' + it.id + '"]');
    const tmp = document.createElement('div'); tmp.innerHTML = cardHtml(it);
    const el = tmp.firstElementChild;
    if (old) {
      const wasOpen = old.querySelector('.fc-details')?.open;
      if (wasOpen !== undefined && el.querySelector('.fc-details')) el.querySelector('.fc-details').open = wasOpen;
      old.replaceWith(el);
    } else $('fileList').appendChild(el);
  }
  const singles = () => items.filter((it) => !it.group);
  function renderAll() {
    const single = singles();
    $('files').hidden = single.length === 0;
    $('groups').hidden = groups.length === 0;
    $('options').hidden = items.length === 0;
    $('dropzone').classList.toggle('compact', items.length > 0);
    $('fileList').innerHTML = '';
    single.forEach(renderItem);
    $('groupList').innerHTML = '';
    groups.forEach(renderGroup);
    updateBar();
  }
  function updateBar() {
    const single = singles();
    const pending = single.filter((it) => it.result && it.status === 'ready').length;
    $('cleanAll').disabled = pending === 0 || single.some((it) => it.status === 'cleaning');
    $('cleanAll').lastChild.textContent = pending > 1 ? ' Limpar todos (' + pending + ')' : ' Limpar todos';
    $('filesTitle').textContent = single.length === 1 ? 'Seu vídeo' : 'Seus vídeos (' + single.length + ')';
  }

  // ---------- adicionar arquivos ----------

  function makeItem(file, group, rel) {
    const it = { id: nextId++, file, rel: rel || file.webkitRelativePath || file.name, group: group || null, result: null, status: 'analyzing' };
    items.push(it);
    it.analysis = VideoMeta.analyze(file)
      .then((r) => { it.result = r; it.status = 'ready'; })
      .catch((e) => { it.status = 'error'; it.error = 'Não foi possível ler este arquivo: ' + e.message; })
      .finally(() => { renderItem(it); updateBar(); });
    return it;
  }

  function addFiles(list) {
    const files = Array.from(list || []).filter((f) => f && f.size);
    if (!files.length) return;
    files.forEach((f) => makeItem(f));
    renderAll();
    $('files').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Pasta (ou seleção múltipla) que vira um .zip. `entries`: [{ file, rel }]. */
  function addFolder(entries, name) {
    const videos = entries.filter((e) => isVideo(e.file));
    const ignored = entries.length - videos.length;
    if (!videos.length) return toast('Nenhum vídeo encontrado' + (name ? ' em "' + name + '"' : '') + '.', true);
    videos.sort((a, b) => a.rel.localeCompare(b.rel, 'pt-BR', { numeric: true }));
    const taken = videos.slice(0, MAX_FOLDER);
    const g = { id: nextGroup++, name: name || 'Vídeos selecionados', status: 'idle', current: 0, progress: 0, allowDeep: false };
    groups.push(g);
    taken.forEach((e) => makeItem(e.file, g.id, e.rel));
    renderAll();
    $('groups').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const notes = [];
    if (videos.length > MAX_FOLDER) notes.push('Só os primeiros ' + MAX_FOLDER + ' de ' + videos.length + ' vídeos foram importados.');
    if (ignored > 0) notes.push(ignored + ' arquivo(s) ignorado(s): não são vídeo, estão vazios ou são ocultos.');
    if (notes.length) toast(notes.join(' '), videos.length > MAX_FOLDER);
  }

  // ---------- limpeza rápida ----------

  async function quickClean(it) {
    it.status = 'cleaning'; it.mode = 'quick'; renderItem(it); updateBar();
    try {
      const { blob } = await VideoMeta.clean(it.file);
      const after = await VideoMeta.analyze(blob);
      it.out = { blob, ext: extOf(it.file) };
      it.remaining = after.findings.length; it.status = 'done';
      download(blob, outputName(it.file, extOf(it.file)));
    } catch (e) { it.status = 'error'; it.error = 'Erro ao limpar: ' + e.message; }
    renderItem(it); updateBar();
  }

  // ---------- limpeza profunda (re-codifica: o arquivo nasce do zero) ----------

  const FORMAT_CANDIDATES = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', '.mp4'],
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', '.mp4'],
    ['video/mp4', '.mp4'],
    ['video/webm;codecs=vp9,opus', '.webm'],
    ['video/webm;codecs=vp8,opus', '.webm'],
    ['video/webm', '.webm'],
  ];
  function pickFormat() {
    if (typeof MediaRecorder === 'undefined') return null;
    return FORMAT_CANDIDATES.find(([m]) => MediaRecorder.isTypeSupported(m)) || null;
  }
  let audioCtx = null;
  const waitEvent = (el, name) => new Promise((res, rej) => {
    el.addEventListener(name, res, { once: true });
    el.addEventListener('error', () => rej(new Error('o navegador não consegue reproduzir este vídeo (codec não suportado, como HEVC em alguns navegadores)')), { once: true });
  });

  async function deepClean(it) {
    const fmt = pickFormat();
    if (!fmt) return toast('Este navegador não grava vídeo. Tente o Chrome, Edge ou Firefox.', true);
    it.status = 'cleaning'; it.mode = 'deep'; it.progress = 0; it.cancel = false; renderItem(it); updateBar();
    try {
      const out = await recordDeep(it, fmt, () => it.cancel);
      if (!out) { it.status = 'ready'; toast('Limpeza profunda cancelada.'); return; }
      it.remaining = out.remaining; it.status = 'done';
      download(out.blob, outputName(it.file, out.ext));
    } catch (e) {
      it.status = 'error'; it.error = 'Limpeza profunda falhou: ' + e.message + '.';
    } finally { renderItem(it); updateBar(); }
  }

  /** Grava o vídeo de novo, do zero. Devolve { blob, ext, remaining } ou null se cancelado. */
  async function recordDeep(it, fmt, isCancelled) {
    const url = URL.createObjectURL(it.file);
    const video = document.createElement('video');
    video.className = 'offscreen'; video.playsInline = true; video.preload = 'auto'; video.src = url;
    document.body.appendChild(video);
    try {
      await waitEvent(video, 'loadeddata');
      const w0 = video.videoWidth || 1280, h0 = video.videoHeight || 720;
      const k = Math.min(1, 3840 / Math.max(w0, h0));
      const W = Math.max(2, Math.round(w0 * k / 2) * 2), H = Math.max(2, Math.round(h0 * k / 2) * 2);
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const src = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest); // vai só para o gravador, não para as caixas de som
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch (e) { console.warn('Sem áudio na limpeza profunda', e); }

      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const bps = Math.min(16e6, Math.max(2.5e6, it.file.size * 8 / dur * 1.15));
      const rec = new MediaRecorder(stream, { mimeType: fmt[0], videoBitsPerSecond: Math.round(bps), audioBitsPerSecond: 160000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => rec.addEventListener('stop', res, { once: true }));

      ctx.drawImage(video, 0, 0, W, H);
      rec.start(1000);
      await video.play();
      let lastPaint = 0;
      await new Promise((resolve) => {
        let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
        const useVfc = 'requestVideoFrameCallback' in video;
        const step = () => {
          if (done) return;
          ctx.drawImage(video, 0, 0, W, H);
          it.progress = Math.min(1, video.currentTime / dur);
          if (Date.now() - lastPaint > 400) { lastPaint = Date.now(); renderItem(it); }
          if (isCancelled() || video.ended) return finish();
          if (useVfc) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
        };
        video.addEventListener('ended', finish, { once: true });
        step();
      });
      video.pause();
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      if (isCancelled()) return null;

      let blob = new Blob(chunks, { type: fmt[0].split(';')[0] });
      try { blob = (await VideoMeta.clean(blob)).blob; } catch (e) { /* o arquivo gravado já não tem nada do original */ }
      const after = await VideoMeta.analyze(blob);
      return { blob, ext: fmt[1], remaining: after.findings.length };
    } finally {
      video.remove(); URL.revokeObjectURL(url);
    }
  }

  // ---------- pasta → .zip ----------

  const groupItems = (g) => items.filter((it) => it.group === g.id);

  function rowHtml(it) {
    const r = it.result, f = r ? r.findings : [];
    const high = f.filter((x) => x.severity === 'alta').length;
    let chip;
    if (it.status === 'analyzing') chip = '<span class="chip">analisando…</span>';
    else if (it.status === 'error') chip = '<span class="chip hot" title="' + esc(it.error || '') + '">erro</span>';
    else if (it.status === 'skipped') chip = '<span class="chip">fora do ZIP</span>';
    else if (it.status === 'cleaning') chip = '<span class="chip">' + (it.mode === 'deep' ? 'profunda ' + Math.round((it.progress || 0) * 100) + '%' : 'limpando…') + '</span>';
    else if (it.status === 'done') chip = '<span class="chip ok">✓ limpo</span>';
    else if (r && r.format === 'unknown') chip = '<span class="chip">formato desconhecido</span>';
    else if (r) chip = (f.length ? '<span class="chip">' + f.length + '</span>' : '<span class="chip ok">nada</span>') + (high ? '<span class="chip hot">' + high + ' sensível(is)</span>' : '');
    return '<li class="g-row"><span class="g-dot" style="background:' + riskColor(it) + '"></span>' +
      '<span class="g-name" title="' + esc(it.rel) + '">' + esc(it.rel) + '</span><span class="g-size">' + fmtSize(it.file.size) + '</span>' +
      '<span class="g-chips">' + (chip || '') + '</span></li>';
  }

  function groupHtml(g) {
    const list = groupItems(g);
    const ready = list.filter((it) => it.result).length;
    const analyzing = list.some((it) => it.status === 'analyzing');
    const totalFind = list.reduce((s, it) => s + (it.result ? it.result.findings.length : 0), 0);
    const sens = list.filter((it) => it.result && it.result.findings.some((f) => f.severity === 'alta')).length;
    const deepCount = list.filter((it) => needsDeep(it)).length;
    const size = list.reduce((s, it) => s + it.file.size, 0);
    const busy = g.status === 'cleaning' || g.status === 'zipping';

    let chips = '<span class="chip">' + list.length + ' vídeo(s)</span>';
    if (analyzing) chips += '<span class="chip">analisando ' + ready + '/' + list.length + '…</span>';
    else {
      chips += '<span class="chip">' + totalFind + ' metadado(s)</span>';
      if (sens) chips += '<span class="chip hot">' + sens + ' com GPS ou dados sensíveis</span>';
    }

    let body = '';
    if (deepCount && g.status === 'idle') {
      body += '<label class="check"><input type="checkbox" data-gact="deep"' + (g.allowDeep ? ' checked' : '') + '> <span>Usar limpeza profunda nos ' + deepCount +
        ' vídeo(s) que a rápida não alcança (trilha de GPS ou formato desconhecido). É lenta: leva o tempo de duração de cada vídeo. Sem ela, esses vídeos ficam fora do ZIP.</span></label>';
    }
    let actions = '';
    if (g.status === 'cleaning') {
      const pct = Math.round(g.progress * 100);
      actions = '<div class="progress"><div style="width:' + pct + '%"></div></div><span class="sub">Limpando ' + Math.min(g.current + 1, list.length) + ' de ' + list.length + '… (mantenha a aba aberta)</span>' +
        '<button class="btn small" data-gact="cancel" type="button">Cancelar</button>';
    } else if (g.status === 'zipping') {
      actions = '<div class="progress"><div style="width:' + Math.round(g.progress * 100) + '%"></div></div><span class="sub">Montando o ZIP… ' + Math.round(g.progress * 100) + '%</span>';
    } else if (g.status === 'done') {
      actions = '<p class="g-done">✓ ZIP pronto: ' + g.zipCount + ' vídeo(s) limpo(s), ' + fmtSize(g.zip.size) + (g.skipped ? ' · ' + g.skipped + ' fora do ZIP' : '') + '</p>' +
        '<button class="btn" data-gact="download" type="button"><svg class="ic sm"><use href="#i-download"/></svg> Baixar o ZIP de novo</button>' +
        '<button class="btn primary" data-gact="schedule" type="button"><svg class="ic sm"><use href="#i-calendar"/></svg> Agendar no Facebook</button>';
    } else {
      actions = '<button class="btn green" data-gact="clean" type="button"' + (analyzing ? ' disabled' : '') + '><svg class="ic sm"><use href="#i-bolt"/></svg> Limpar tudo e baixar ZIP</button>' +
        '<button class="btn" data-gact="schedule" type="button"' + (analyzing ? ' disabled' : '') + '><svg class="ic sm"><use href="#i-calendar"/></svg> Agendar no Facebook</button>';
    }

    return '<article class="folder gcard" data-gid="' + g.id + '" style="--tab: var(--purple)">' +
      '<div class="fc-top"><span class="tile" style="--tile: var(--purple)"><svg class="ic"><use href="#i-folder"/></svg></span>' +
      '<div class="fc-info"><h3>' + esc(g.name) + '</h3><span class="sub">' + fmtSize(size) + ' · vira um único .zip</span><div class="chips">' + chips + '</div></div>' +
      (busy ? '' : '<button class="mini" data-gact="remove" type="button" title="Tirar da lista" aria-label="Tirar pasta da lista"><svg class="ic sm"><use href="#i-x"/></svg></button>') +
      '</div>' + body +
      '<details class="fc-details"' + (g.open ? ' open' : '') + '><summary>Ver os ' + list.length + ' vídeo(s)</summary><ol class="g-list">' + list.map(rowHtml).join('') + '</ol></details>' +
      '<div class="fc-actions">' + actions + '</div></article>';
  }

  let groupPaint = 0;
  function renderGroup(g, force) {
    if (!g) return;
    const old = document.querySelector('.gcard[data-gid="' + g.id + '"]');
    // durante a limpeza, redesenha no máximo ~3 vezes por segundo (até 100 linhas)
    if (old && !force && g.status === 'cleaning' && Date.now() - groupPaint < 300) return;
    groupPaint = Date.now();
    if (old) g.open = old.querySelector('.fc-details')?.open || false;
    const tmp = document.createElement('div'); tmp.innerHTML = groupHtml(g);
    if (old) old.replaceWith(tmp.firstElementChild); else $('groupList').appendChild(tmp.firstElementChild);
  }

  function zipEntryName(it, ext, used) {
    let name;
    if (useRandomNames()) name = 'video-' + randomHex() + ext;
    else {
      const parts = it.rel.split('/'); if (parts.length > 1) parts.shift(); // tira o nome da pasta principal
      name = parts.join('/').replace(/\.[^./]+$/, '') + '-limpo' + ext;
    }
    let final = name, n = 2;
    while (used.has(final.toLowerCase())) final = name.replace(/(\.[^./]+)$/, ' (' + n++ + ')$1');
    used.add(final.toLowerCase());
    return final;
  }

  async function cleanGroup(g) {
    const list = groupItems(g);
    await Promise.all(list.map((it) => it.analysis));
    const fmt = pickFormat();
    g.status = 'cleaning'; g.cancel = false; g.progress = 0; renderGroup(g, true);
    const totalBytes = list.reduce((s, it) => s + it.file.size, 0) || 1;
    let doneBytes = 0;

    for (let i = 0; i < list.length && !g.cancel; i++) {
      const it = list[i]; g.current = i;
      if (it.status === 'error') { doneBytes += it.file.size; continue; }
      const wantDeep = needsDeep(it) && g.allowDeep && fmt;
      try {
        if (wantDeep) {
          it.status = 'cleaning'; it.mode = 'deep'; it.progress = 0; renderGroup(g, true);
          const out = await recordDeep(it, fmt, () => g.cancel);
          if (!out) break;
          it.out = out; it.remaining = out.remaining; it.status = 'done';
        } else if (it.result && it.result.cleanable) {
          it.status = 'cleaning'; it.mode = 'quick'; renderGroup(g);
          const { blob } = await VideoMeta.clean(it.file);
          const after = await VideoMeta.analyze(blob);
          it.out = { blob, ext: extOf(it.file) }; it.remaining = after.findings.length; it.status = 'done';
        } else {
          it.status = 'skipped';
        }
      } catch (e) { it.status = 'error'; it.error = e.message; }
      doneBytes += it.file.size;
      g.progress = doneBytes / totalBytes;
      renderGroup(g);
    }
    if (g.cancel) {
      list.forEach((it) => { if (it.status === 'cleaning') it.status = 'ready'; });
      g.status = 'idle'; renderGroup(g, true); return toast('Limpeza da pasta cancelada.');
    }

    const used = new Set();
    const entries = list.filter((it) => it.status === 'done' && it.out).map((it) => ({ name: zipEntryName(it, it.out.ext, used), blob: it.out.blob }));
    g.skipped = list.length - entries.length;
    if (!entries.length) { g.status = 'idle'; renderGroup(g, true); return toast('Nenhum vídeo pôde ser limpo nesta pasta.', true); }

    g.status = 'zipping'; g.progress = 0; renderGroup(g, true);
    let lastZipPaint = 0;
    g.zip = await MiniZip.createZip(entries, (done, total) => {
      g.progress = total ? done / total : 1;
      if (Date.now() - lastZipPaint > 250) { lastZipPaint = Date.now(); renderGroup(g, true); }
    });
    g.zipCount = entries.length;
    g.zipName = useRandomNames() ? 'videos-limpos-' + randomHex() + '.zip' : g.name.replace(/[\\/:*?"<>|]+/g, '_') + '-limpo.zip';
    g.status = 'done'; renderGroup(g, true);
    download(g.zip, g.zipName);
    toast('ZIP pronto com ' + entries.length + (entries.length === 1 ? ' vídeo limpo.' : ' vídeos limpos.') + (g.skipped ? ' ' + g.skipped + (g.skipped === 1 ? ' ficou' : ' ficaram') + ' de fora (veja a lista).' : ''));
  }

  $('groupList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gact]'); if (!btn || btn.tagName === 'INPUT') return;
    const g = groups.find((x) => x.id === Number(btn.closest('.gcard').dataset.gid)); if (!g) return;
    const act = btn.dataset.gact;
    if (act === 'clean') cleanGroup(g);
    else if (act === 'cancel') g.cancel = true;
    else if (act === 'download') download(g.zip, g.zipName);
    else if (act === 'schedule') openScheduler(g.name, groupItems(g));
    else if (act === 'remove') {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].group === g.id) items.splice(i, 1);
      groups.splice(groups.indexOf(g), 1); renderAll();
    }
  });
  $('groupList').addEventListener('change', (e) => {
    if (e.target.dataset.gact !== 'deep') return;
    const g = groups.find((x) => x.id === Number(e.target.closest('.gcard').dataset.gid));
    if (g) g.allowDeep = e.target.checked;
  });

  // Ler pastas arrastadas (Chrome, Edge, Firefox, Safari no computador)
  function readEntry(entry, out) {
    return new Promise((resolve) => {
      if (entry.isFile) entry.file((f) => { out.push({ file: f, rel: entry.fullPath.replace(/^\//, '') }); resolve(); }, () => resolve());
      else if (entry.isDirectory) {
        const reader = entry.createReader(); const all = [];
        const next = () => reader.readEntries(async (batch) => {
          if (!batch.length) { for (const e of all) await readEntry(e, out); resolve(); }
          else { all.push(...batch); next(); }
        }, () => resolve());
        next();
      } else resolve();
    });
  }

  // ---------- agendar no Facebook ----------

  /** Entrega ao agendador só vídeos que dá para enviar limpos (limpa na hora, se ainda não estiverem). */
  function openScheduler(title, list) {
    if (!window.Scheduler) return toast('O agendamento não carregou. Recarregue a página.', true);
    const usable = [], excluded = [];
    for (const it of list) {
      const ok = it.result && it.status !== 'error' && (it.out || it.result.cleanable);
      (ok ? usable : excluded).push(it);
    }
    if (!usable.length) return toast('Nenhum vídeo pronto para agendar (formato não suportado ou ainda analisando).', true);
    Scheduler.open({
      title,
      excluded,
      entries: usable.map((it) => ({
        name: it.rel ? it.rel.split('/').pop() : it.file.name,
        file: it.file,
        warn: needsDeep(it) && !(it.out && it.mode === 'deep') ? 'Tem dados (como trilha de GPS) que só a limpeza profunda remove.' : '',
        async getBlob() {
          if (it.out) return it.out.blob;
          const { blob } = await VideoMeta.clean(it.file);
          const after = await VideoMeta.analyze(blob);
          it.out = { blob, ext: extOf(it.file) }; it.remaining = after.findings.length; it.status = 'done'; it.mode = 'quick';
          return blob;
        },
      })),
    });
  }

  // ---------- ações ----------

  $('fileList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const it = items.find((x) => x.id === Number(btn.closest('.fcard').dataset.id)); if (!it) return;
    const act = btn.dataset.act;
    if (act === 'remove') { items.splice(items.indexOf(it), 1); renderAll(); }
    else if (act === 'quick') quickClean(it);
    else if (act === 'deep') deepClean(it);
    else if (act === 'cancel') it.cancel = true;
  });

  $('cleanAll').addEventListener('click', async () => {
    const todo = singles().filter((it) => it.result && it.status === 'ready');
    for (const it of todo) {
      // rápida sempre que possível; quem precisar da profunda continua com o botão no cartão
      if (it.result.cleanable) await quickClean(it); else await deepClean(it);
    }
    const left = todo.filter((it) => it.status === 'done' && needsDeep(it)).length;
    toast(todo.length + ' vídeo(s) processado(s).' + (left ? ' ' + left + ' ainda pode(m) usar a limpeza profunda.' : ''));
  });
  $('scheduleSingles').addEventListener('click', () => openScheduler('Vídeos', singles()));
  $('clearList').addEventListener('click', () => {
    if (singles().some((it) => it.status === 'cleaning')) return toast('Espere terminar a limpeza em andamento.', true);
    for (let i = items.length - 1; i >= 0; i--) if (!items[i].group) items.splice(i, 1);
    renderAll();
  });

  // Aviso de versão nova: o Safari às vezes mostra a página guardada em cache depois de uma atualização.
  (function checkUpdate() {
    const current = document.body.dataset.version;
    if (!current || !window.fetch || location.protocol === 'file:') return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (!info || !info.version || info.version === current) return;
        $('updateBar').hidden = false;
        $('updateBtn').addEventListener('click', () => { location.href = location.pathname + '?v=' + encodeURIComponent(info.version); });
      })
      .catch(() => { /* sem internet: segue com a versão atual */ });
  })();

  const pick = () => $('fileInput').click();
  $('pickBtn').addEventListener('click', pick);
  $('pickBar').addEventListener('click', pick);
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('folderBtn').addEventListener('click', () => $('folderInput').click());
  $('folderInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return toast('Nenhum arquivo veio da pasta. No iPhone, entre na pasta antes de tocar em Abrir. Se não der, use "Selecionar vídeos".', true);
    const root = (files[0].webkitRelativePath || '').split('/')[0] || 'Pasta';
    addFolder(files.map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })), root);
  });
  $('zipPickBtn').addEventListener('click', () => $('zipFilesInput').click());
  $('zipFilesInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (files.length) addFolder(files.map((f) => ({ file: f, rel: f.name })), 'Vídeos selecionados');
  });
  // "Importar pasta" funciona em todos os navegadores atuais, inclusive no iPhone/iPad (Safari 18.4+).
  // No iPhone/iPad, o seletor de pastas confunde (os vídeos aparecem apagados), então mostramos o passo a passo.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.body.classList.add(isIOS ? 'is-ios' : 'not-ios');

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer; if (!dt) return;
    const droppedFiles = Array.from(dt.files || []); // capturar antes de qualquer await
    const entries = Array.from(dt.items || []).map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const dirs = entries.filter((en) => en.isDirectory);
    if (dirs.length) {
      // pasta arrastada: modo ZIP (uma por pasta)
      for (const d of dirs) { const out = []; await readEntry(d, out); addFolder(out, d.name); }
      const loose = entries.filter((en) => en.isFile).length;
      if (loose) addFiles(droppedFiles.filter((f) => isVideo(f)));
    } else addFiles(droppedFiles);
  });
})();
