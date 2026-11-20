/* app.js — Vídeo Limpo: analisa e remove metadados de vídeos, tudo no navegador. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const items = [];          // { id, file, result, status, error, progress, remaining, mode }
  let nextId = 1;

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
  function outputName(file, ext) {
    if ($('randomName').checked) {
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
      return 'video-' + rnd + ext;
    }
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
    const old = document.querySelector('.fcard[data-id="' + it.id + '"]');
    const tmp = document.createElement('div'); tmp.innerHTML = cardHtml(it);
    const el = tmp.firstElementChild;
    if (old) {
      const wasOpen = old.querySelector('.fc-details')?.open;
      if (wasOpen !== undefined && el.querySelector('.fc-details')) el.querySelector('.fc-details').open = wasOpen;
      old.replaceWith(el);
    } else $('fileList').appendChild(el);
  }
  function renderAll() {
    $('files').hidden = items.length === 0;
    $('dropzone').classList.toggle('compact', items.length > 0);
    $('fileList').innerHTML = '';
    items.forEach(renderItem);
    updateBar();
  }
  function updateBar() {
    const pending = items.filter((it) => it.result && it.status === 'ready').length;
    $('cleanAll').disabled = pending === 0 || items.some((it) => it.status === 'cleaning');
    $('cleanAll').lastChild.textContent = pending > 1 ? ' Limpar todos (' + pending + ')' : ' Limpar todos';
    $('filesTitle').textContent = items.length === 1 ? 'Seu vídeo' : 'Seus vídeos (' + items.length + ')';
  }

  // ---------- adicionar arquivos ----------

  function addFiles(list) {
    const files = Array.from(list || []).filter((f) => f && f.size);
    if (!files.length) return;
    for (const file of files) {
      const it = { id: nextId++, file, result: null, status: 'analyzing' };
      items.push(it);
      VideoMeta.analyze(file)
        .then((r) => { it.result = r; it.status = 'ready'; })
        .catch((e) => { it.status = 'error'; it.error = 'Não foi possível ler este arquivo: ' + e.message; })
        .finally(() => { renderItem(it); updateBar(); });
    }
    renderAll();
    $('files').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- limpeza rápida ----------

  async function quickClean(it) {
    it.status = 'cleaning'; it.mode = 'quick'; renderItem(it); updateBar();
    try {
      const { blob } = await VideoMeta.clean(it.file);
      const after = await VideoMeta.analyze(blob);
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
          if (it.cancel || video.ended) return finish();
          if (useVfc) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
        };
        video.addEventListener('ended', finish, { once: true });
        step();
      });
      video.pause();
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      if (it.cancel) { it.status = 'ready'; toast('Limpeza profunda cancelada.'); return; }

      let blob = new Blob(chunks, { type: fmt[0].split(';')[0] });
      try { blob = (await VideoMeta.clean(blob)).blob; } catch (e) { /* o arquivo gravado já não tem nada do original */ }
      const after = await VideoMeta.analyze(blob);
      it.remaining = after.findings.length; it.status = 'done';
      download(blob, outputName(it.file, fmt[1]));
    } catch (e) {
      it.status = 'error'; it.error = 'Limpeza profunda falhou: ' + e.message + '.';
    } finally {
      video.remove(); URL.revokeObjectURL(url);
      renderItem(it); updateBar();
    }
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
    const todo = items.filter((it) => it.result && it.status === 'ready');
    for (const it of todo) {
      // rápida sempre que possível; quem precisar da profunda continua com o botão no cartão
      if (it.result.cleanable) await quickClean(it); else await deepClean(it);
    }
    const left = todo.filter((it) => it.status === 'done' && needsDeep(it)).length;
    toast(todo.length + ' vídeo(s) processado(s).' + (left ? ' ' + left + ' ainda pode(m) usar a limpeza profunda.' : ''));
  });
  $('clearList').addEventListener('click', () => {
    if (items.some((it) => it.status === 'cleaning')) return toast('Espere terminar a limpeza em andamento.', true);
    items.length = 0; renderAll();
  });

  const pick = () => $('fileInput').click();
  $('pickBtn').addEventListener('click', pick);
  $('pickBar').addEventListener('click', pick);
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
})();
