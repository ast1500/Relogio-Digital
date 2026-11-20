/* app.js — editor de vídeo no navegador (Canvas + Web Audio + MediaRecorder). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const preview = $('preview');
  const pctx = preview.getContext('2d');

  const PREVIEW_MAX = 1280;   // lado maior da prévia (a exportação usa a resolução cheia)
  const OUTPUT_MAX = 3840;    // lado maior máximo do arquivo exportado
  const EXPORT_FPS = 30;

  const CROPS = { orig: null, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };

  const state = {
    file: null, url: null, meta: null, playable: false,
    trimStart: 0, trimEnd: 0,
    crop: 'orig', rot: 0, flipH: false, flipV: false, scale: 1,
    brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: false,
    speed: 1, volume: 100, mute: false,
    text: '', textPos: 'bottom', textColor: '#ffffff', textSize: 6,
    redactions: [], drawing: false,
    exporting: false, cancel: false,
  };

  // ---------- utilidades ----------

  function fmtTime(s) {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60), r = s - m * 60;
    return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0');
  }
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
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function outputName(ext) {
    if ($('randomName').checked) {
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
      return 'video-' + rnd + ext;
    }
    return state.file.name.replace(/\.[^.]+$/, '') + '-limpo' + ext;
  }
  const dur = () => (isFinite(video.duration) ? video.duration : 0);

  // ---------- áudio (Web Audio: volume acima de 100% e trilha para gravação) ----------

  let audio = null;
  function ensureAudio() {
    if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return audio; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(video);
      const gain = ctx.createGain(), monitor = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain); gain.connect(monitor); monitor.connect(ctx.destination); gain.connect(dest);
      audio = { ctx, gain, monitor, dest };
      applyVolume();
    } catch (e) { console.warn('Web Audio indisponível', e); }
    return audio;
  }
  function applyVolume() {
    if (audio) audio.gain.gain.value = state.mute ? 0 : state.volume / 100;
    else video.volume = state.mute ? 0 : Math.min(1, state.volume / 100);
  }

  // ---------- geometria e desenho ----------

  /** Calcula recorte na origem e tamanho de saída (antes de qualquer limite de prévia). */
  function geometry() {
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const sideways = state.rot % 180 !== 0;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    const target = CROPS[state.crop];
    if (target) {
      const r = sideways ? 1 / target : target; // proporção do recorte na imagem original
      if (vw / vh > r) { sw = vh * r; sx = (vw - sw) / 2; } else { sh = vw / r; sy = (vh - sh) / 2; }
    }
    let ow = (sideways ? sh : sw) * state.scale, oh = (sideways ? sw : sh) * state.scale;
    const k = Math.min(1, OUTPUT_MAX / Math.max(ow, oh));
    ow = Math.max(2, Math.round(ow * k / 2) * 2); oh = Math.max(2, Math.round(oh * k / 2) * 2); // codecs exigem par
    return { sx, sy, sw, sh, ow, oh, sideways };
  }

  function filterString() {
    const f = [];
    if (state.brightness !== 100) f.push('brightness(' + state.brightness + '%)');
    if (state.contrast !== 100) f.push('contrast(' + state.contrast + '%)');
    if (state.saturate !== 100) f.push('saturate(' + state.saturate + '%)');
    if (state.grayscale) f.push('grayscale(100%)');
    if (state.blur > 0) f.push('blur(' + state.blur + 'px)');
    return f.length ? f.join(' ') : 'none';
  }

  const pixCanvas = document.createElement('canvas');
  const pixCtx = pixCanvas.getContext('2d');

  /** Desenha o quadro atual com todas as edições em ctx (W×H). */
  function drawFrame(ctx, W, H, g) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const fs = filterString();
    if (fs !== 'none' && 'filter' in ctx) ctx.filter = fs.replace(/blur\((\d+)px\)/, (_, n) => 'blur(' + (n * W / 1000) + 'px)');
    ctx.translate(W / 2, H / 2);
    ctx.rotate(state.rot * Math.PI / 180);
    ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
    const dw = g.sideways ? H : W, dh = g.sideways ? W : H;
    if (video.readyState >= 2) ctx.drawImage(video, g.sx, g.sy, g.sw, g.sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    // Áreas ocultas: pixeladas (coordenadas normalizadas na imagem final)
    for (const r of state.redactions) {
      const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
      if (w < 2 || h < 2) continue;
      const block = Math.max(8, Math.round(Math.max(W, H) / 60));
      const pw = Math.max(1, Math.round(w / block)), ph = Math.max(1, Math.round(h / block));
      pixCanvas.width = pw; pixCanvas.height = ph;
      pixCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, pw, ph);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixCanvas, 0, 0, pw, ph, x, y, w, h);
      ctx.restore();
    }
    if (state.drawing && drag && drag.redact) {
      ctx.save(); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(3, W / 300); ctx.setLineDash([10, 6]);
      ctx.strokeRect(drag.redact.x * W, drag.redact.y * H, drag.redact.w * W, drag.redact.h * H); ctx.restore();
    }

    // Texto
    if (state.text.trim()) {
      const size = Math.round(H * state.textSize / 100);
      ctx.save();
      ctx.font = '700 ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = state.textPos === 'top' ? 'top' : state.textPos === 'center' ? 'middle' : 'bottom';
      const y = state.textPos === 'top' ? H * 0.05 : state.textPos === 'center' ? H / 2 : H * 0.95;
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(state.text, W / 2, y, W * 0.92);
      ctx.fillStyle = state.textColor; ctx.fillText(state.text, W / 2, y, W * 0.92);
      ctx.restore();
    }
  }

  function renderPreview() {
    const g = geometry();
    const k = Math.min(1, PREVIEW_MAX / Math.max(g.ow, g.oh));
    const W = Math.round(g.ow * k), H = Math.round(g.oh * k);
    if (preview.width !== W || preview.height !== H) { preview.width = W; preview.height = H; }
    drawFrame(pctx, W, H, g);
    updateTimeUI();
  }

  let rafId = 0;
  function loop() {
    if (!state.exporting) {
      if (!video.paused && video.currentTime >= state.trimEnd - 0.03) { video.pause(); video.currentTime = state.trimStart; }
      renderPreview();
    }
    rafId = video.paused ? 0 : requestAnimationFrame(loop);
  }
  function kick() { if (!rafId) rafId = requestAnimationFrame(loop); }

  // ---------- linha do tempo ----------

  function updateTimeUI() {
    const d = dur(), t = video.currentTime;
    $('timeLabel').textContent = fmtTime(t) + ' / ' + fmtTime(d);
    if (document.activeElement !== $('seek')) $('seek').value = d ? Math.round(t / d * 1000) : 0;
    $('trimCursor').style.left = (d ? t / d * 100 : 0) + '%';
    $('playBtn').textContent = video.paused ? '▶' : '❚❚';
  }
  function updateTrimUI() {
    const d = dur();
    $('trimSel').style.left = (d ? state.trimStart / d * 100 : 0) + '%';
    $('trimSel').style.width = (d ? (state.trimEnd - state.trimStart) / d * 100 : 100) + '%';
    if (document.activeElement !== $('trimStart')) $('trimStart').value = state.trimStart.toFixed(1);
    if (document.activeElement !== $('trimEnd')) $('trimEnd').value = state.trimEnd.toFixed(1);
    $('trimStart').max = $('trimEnd').max = d.toFixed(1);
    const final = (state.trimEnd - state.trimStart) / state.speed;
    $('trimInfo').textContent = 'Duração final: ' + fmtTime(final) + (state.speed !== 1 ? ' (a ' + String(state.speed).replace('.', ',') + '×)' : '');
  }
  function setTrim(start, end) {
    const d = dur();
    start = Math.max(0, Math.min(start, d)); end = Math.max(0, Math.min(end, d));
    if (end - start < 0.2) { if (start + 0.2 <= d) end = start + 0.2; else start = Math.max(0, end - 0.2); }
    state.trimStart = start; state.trimEnd = end; updateTrimUI();
  }

  let drag = null;
  $('trimTrack').addEventListener('pointerdown', (e) => {
    const rect = e.currentTarget.getBoundingClientRect(), d = dur(); if (!d) return;
    const tAt = (x) => Math.max(0, Math.min(d, (x - rect.left) / rect.width * d));
    const xs = rect.left + state.trimStart / d * rect.width, xe = rect.left + state.trimEnd / d * rect.width;
    const mode = Math.abs(e.clientX - xs) < 10 ? 'start' : Math.abs(e.clientX - xe) < 10 ? 'end' : 'seek';
    const move = (ev) => {
      const t = tAt(ev.clientX);
      if (mode === 'start') setTrim(Math.min(t, state.trimEnd - 0.2), state.trimEnd);
      else if (mode === 'end') setTrim(state.trimStart, Math.max(t, state.trimStart + 0.2));
      video.currentTime = t;
    };
    move(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const up = () => { e.currentTarget.removeEventListener('pointermove', move); e.currentTarget.removeEventListener('pointerup', up); };
    e.currentTarget.addEventListener('pointermove', move);
    e.currentTarget.addEventListener('pointerup', up);
  });
  $('trimStart').addEventListener('change', (e) => setTrim(parseFloat(e.target.value) || 0, state.trimEnd));
  $('trimEnd').addEventListener('change', (e) => setTrim(state.trimStart, parseFloat(e.target.value) || 0));
  $('setStart').addEventListener('click', () => setTrim(video.currentTime, Math.max(state.trimEnd, video.currentTime + 0.2)));
  $('setEnd').addEventListener('click', () => setTrim(Math.min(state.trimStart, video.currentTime - 0.2), video.currentTime));
  $('seek').addEventListener('input', (e) => { video.currentTime = e.target.value / 1000 * dur(); });

  function togglePlay() {
    if (!state.playable || state.exporting) return;
    ensureAudio();
    if (video.paused) {
      if (video.currentTime < state.trimStart || video.currentTime >= state.trimEnd - 0.05) video.currentTime = state.trimStart;
      video.playbackRate = state.speed;
      video.play().catch((err) => toast('Não foi possível reproduzir: ' + err.message, true));
    } else video.pause();
  }
  $('playBtn').addEventListener('click', togglePlay);
  video.addEventListener('play', kick);
  video.addEventListener('pause', () => { renderPreview(); });
  video.addEventListener('seeked', () => { if (!state.exporting) renderPreview(); });

  document.addEventListener('keydown', (e) => {
    if (!state.file || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'i' || e.key === 'I') $('setStart').click();
    else if (e.key === 'o' || e.key === 'O') $('setEnd').click();
    else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 5 : 1 / 30));
    else if (e.key === 'ArrowRight') video.currentTime = Math.min(dur(), video.currentTime + (e.shiftKey ? 5 : 1 / 30));
  });

  // ---------- áreas ocultas (desenhar sobre a prévia) ----------

  $('drawRedact').addEventListener('click', () => {
    state.drawing = !state.drawing;
    $('drawRedact').classList.toggle('on', state.drawing);
    preview.classList.toggle('drawing', state.drawing);
    if (state.drawing) toast('Arraste sobre a prévia para marcar a área a ocultar.');
  });
  $('clearRedact').addEventListener('click', () => { state.redactions = []; renderPreview(); });
  preview.addEventListener('pointerdown', (e) => {
    if (!state.drawing) return;
    const rect = preview.getBoundingClientRect();
    const pt = (ev) => ({ x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)) });
    const a = pt(e);
    drag = { redact: { x: a.x, y: a.y, w: 0, h: 0 } };
    preview.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const b = pt(ev);
      drag.redact = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      renderPreview();
    };
    const up = () => {
      preview.removeEventListener('pointermove', move); preview.removeEventListener('pointerup', up);
      if (drag.redact.w > 0.01 && drag.redact.h > 0.01) state.redactions.push(drag.redact);
      drag = null; renderPreview();
    };
    preview.addEventListener('pointermove', move); preview.addEventListener('pointerup', up);
  });

  // ---------- controles de edição ----------

  function bindRange(id, key, unit) {
    const el = $(id), out = $(id + 'Out');
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      if (out) out.textContent = el.value + unit;
      if (key === 'volume') applyVolume();
      renderPreview();
    });
  }
  bindRange('brightness', 'brightness', '%'); bindRange('contrast', 'contrast', '%');
  bindRange('saturate', 'saturate', '%'); bindRange('blur', 'blur', 'px');
  bindRange('volume', 'volume', '%'); bindRange('overlaySize', 'textSize', '%');
  $('grayscale').addEventListener('change', (e) => { state.grayscale = e.target.checked; renderPreview(); });
  $('resetFx').addEventListener('click', () => {
    [['brightness', 100, '%'], ['contrast', 100, '%'], ['saturate', 100, '%'], ['blur', 0, 'px']].forEach(([k, v, u]) => {
      state[k] = v; $(k).value = v; $(k + 'Out').textContent = v + u;
    });
    state.grayscale = false; $('grayscale').checked = false; renderPreview();
  });
  $('mute').addEventListener('change', (e) => { state.mute = e.target.checked; applyVolume(); });
  $('speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); video.playbackRate = state.speed; updateTrimUI(); });
  $('scale').addEventListener('change', (e) => { state.scale = Number(e.target.value); renderPreview(); updateFileDetails(); });
  $('cropSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.crop = b.dataset.crop;
    $('cropSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderPreview(); updateFileDetails();
  });
  $('rotL').addEventListener('click', () => { state.rot = (state.rot + 270) % 360; renderPreview(); updateFileDetails(); });
  $('rotR').addEventListener('click', () => { state.rot = (state.rot + 90) % 360; renderPreview(); updateFileDetails(); });
  $('flipH').addEventListener('click', () => { state.flipH = !state.flipH; $('flipH').classList.toggle('on', state.flipH); renderPreview(); });
  $('flipV').addEventListener('click', () => { state.flipV = !state.flipV; $('flipV').classList.toggle('on', state.flipV); renderPreview(); });
  $('overlayText').addEventListener('input', (e) => { state.text = e.target.value; renderPreview(); });
  $('overlayPos').addEventListener('change', (e) => { state.textPos = e.target.value; renderPreview(); });
  $('overlayColor').addEventListener('input', (e) => { state.textColor = e.target.value; renderPreview(); });

  // ---------- formatos de exportação ----------

  const FORMAT_CANDIDATES = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'MP4 (H.264 + AAC)', '.mp4'],
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'MP4 (H.264 + AAC)', '.mp4'],
    ['video/mp4', 'MP4 (codec padrão do navegador)', '.mp4'],
    ['video/webm;codecs=vp9,opus', 'WebM (VP9 + Opus)', '.webm'],
    ['video/webm;codecs=vp8,opus', 'WebM (VP8 + Opus)', '.webm'],
    ['video/webm', 'WebM', '.webm'],
  ];
  function fillFormats() {
    const sel = $('format'); sel.innerHTML = '';
    if (typeof MediaRecorder === 'undefined') { sel.innerHTML = '<option>Indisponível neste navegador</option>'; $('exportBtn').disabled = true; return; }
    const seenLabel = new Set();
    for (const [mime, label, ext] of FORMAT_CANDIDATES) {
      if (!MediaRecorder.isTypeSupported(mime) || seenLabel.has(label)) continue;
      if (label.startsWith('MP4 (codec') && seenLabel.has('MP4 (H.264 + AAC)')) continue;
      if (label === 'WebM' && (seenLabel.has('WebM (VP9 + Opus)') || seenLabel.has('WebM (VP8 + Opus)'))) continue;
      seenLabel.add(label);
      const o = document.createElement('option'); o.value = mime; o.textContent = label; o.dataset.ext = ext; sel.appendChild(o);
    }
    if (!sel.options.length) { sel.innerHTML = '<option>Nenhum formato suportado</option>'; $('exportBtn').disabled = true; }
  }

  // ---------- exportação (re-codificação) ----------

  function waitEvent(el, name) { return new Promise((res) => el.addEventListener(name, res, { once: true })); }

  async function exportVideo() {
    if (!state.playable) return toast('Este vídeo não pode ser decodificado pelo navegador, então não dá para re-codificar. Use a limpeza sem re-codificação.', true);
    const opt = $('format').selectedOptions[0]; if (!opt) return;
    const a = ensureAudio();
    const g = geometry();
    const canvas = document.createElement('canvas'); canvas.width = g.ow; canvas.height = g.oh;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(EXPORT_FPS);
    if (!state.mute && a) a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: opt.value, videoBitsPerSecond: Number($('quality').value), audioBitsPerSecond: 160000 });
    } catch (e) { return toast('Falha ao iniciar o gravador: ' + e.message, true); }

    state.exporting = true; state.cancel = false;
    $('exportOverlay').hidden = false; $('exportBar').style.width = '0%';
    $('exportStatus').textContent = 'Preparando…';
    document.querySelectorAll('.tools button, .tools select, .tools input, #quickClean').forEach((el) => { el.dataset.wasDisabled = el.disabled; el.disabled = true; });

    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = waitEvent(rec, 'stop');

    video.pause();
    video.currentTime = state.trimStart; await waitEvent(video, 'seeked');
    drawFrame(ctx, g.ow, g.oh, g);
    if (a) a.monitor.gain.value = 0; // não toca o áudio nas caixas de som durante a exportação
    video.playbackRate = state.speed;
    rec.start(1000);
    try { await video.play(); } catch (e) { state.cancel = true; toast('Falha ao reproduzir: ' + e.message, true); }

    const total = state.trimEnd - state.trimStart;
    await new Promise((resolve) => {
      const useVfc = 'requestVideoFrameCallback' in video;
      const step = () => {
        const t = video.currentTime;
        drawFrame(ctx, g.ow, g.oh, g);
        const p = Math.min(1, Math.max(0, (t - state.trimStart) / total));
        $('exportBar').style.width = (p * 100).toFixed(1) + '%';
        $('exportStatus').textContent = 'Exportando… ' + Math.round(p * 100) + '% — mantenha esta aba aberta e visível';
        if (state.cancel || video.ended || t >= state.trimEnd) return resolve();
        if (useVfc) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
      };
      // Garante término mesmo se não chegarem mais quadros (fim do arquivo)
      video.addEventListener('ended', resolve, { once: true });
      step();
    });
    video.pause();
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    if (a) a.monitor.gain.value = 1;

    state.exporting = false;
    document.querySelectorAll('.tools button, .tools select, .tools input, #quickClean').forEach((el) => { el.disabled = el.dataset.wasDisabled === 'true'; });
    $('exportOverlay').hidden = true;
    renderPreview();
    if (state.cancel) return toast('Exportação cancelada.');

    let blob = new Blob(chunks, { type: opt.value.split(';')[0] });
    // O gravador do navegador já não copia nada do original; ainda assim passamos o limpador no MP4 gerado.
    if (opt.dataset.ext === '.mp4') { try { blob = (await VideoMeta.clean(blob)).blob; } catch (e) { /* mantém como está */ } }
    download(blob, outputName(opt.dataset.ext));
    toast('Pronto! ' + fmtSize(blob.size) + ' exportados sem metadados do original.');
  }
  $('exportBtn').addEventListener('click', exportVideo);
  $('cancelExport').addEventListener('click', () => { state.cancel = true; });

  // ---------- metadados ----------

  const CAT_STYLE = {
    'Localização': ['i-pin', 'var(--pink)'], 'Identificação': ['i-id', 'var(--pink)'],
    'Aparelho': ['i-phone', 'var(--purple)'], 'Data': ['i-calendar', 'var(--yellow)'],
    'Autoria': ['i-user', 'var(--sand)'], 'Software': ['i-code', 'var(--lime)'],
    'XMP': ['i-tag', 'var(--sand)'], 'Outros': ['i-tag', 'var(--gray)'],
  };
  function iconTile(iconId, color) {
    const t = document.createElement('span'); t.className = 'tile'; t.style.setProperty('--tile', color);
    t.innerHTML = '<svg class="ic"><use href="#' + iconId + '"/></svg>';
    return t;
  }

  function renderMeta(result) {
    const list = $('metaList'); list.innerHTML = '';
    const f = result.findings;
    const high = f.filter((x) => x.severity === 'alta').length;
    $('metaSummary').textContent = f.length ? f.length + ' item(ns) encontrados' + (high ? ' · ' + high + ' sensível(is)' : '') : 'nada a esconder';
    if (result.format === 'unknown') {
      list.innerHTML = '<div class="meta-note">Formato não reconhecido para leitura de metadados. A exportação com re-codificação ainda gera um arquivo limpo.</div>';
    } else if (!f.length) {
      list.innerHTML = '<div class="meta-empty"><span class="tile" style="--tile:#fff"><svg class="ic"><use href="#i-check"/></svg></span>Nenhum metadado identificável encontrado.</div>';
    }
    const order = { alta: 0, 'média': 1, baixa: 2 };
    for (const x of f.slice().sort((p, q) => order[p.severity] - order[q.severity])) {
      const row = document.createElement('div'); row.className = 'meta-row';
      const sev = document.createElement('span'); sev.className = 'sev ' + x.severity; sev.textContent = x.severity;
      const body = document.createElement('div');
      const label = document.createElement('div'); label.className = 'label'; label.textContent = x.label;
      const value = document.createElement('div'); value.className = 'value'; value.textContent = x.value;
      const where = document.createElement('div'); where.className = 'where';
      where.textContent = x.category + ' · ' + x.where + (x.removable ? '' : ' · só sai com a exportação re-codificada');
      body.append(label, value, where);
      const st = CAT_STYLE[x.category] || CAT_STYLE.Outros;
      row.append(iconTile(st[0], st[1]), body, sev); list.appendChild(row);
    }
    if (result.format === 'webm') {
      const n = document.createElement('div'); n.className = 'meta-note';
      n.textContent = 'Para WebM/MKV, a limpeza é feita pela exportação (re-codificação).';
      list.appendChild(n);
    }
    const qc = $('quickClean');
    qc.disabled = !result.cleanable;
    $('quickCleanHint').textContent = result.cleanable
      ? (f.some((x) => !x.removable)
        ? 'Remove GPS, aparelho, datas e software sem perder qualidade. Itens marcados como “só sai com a exportação” exigem re-codificar.'
        : 'Mantém a qualidade original; remove GPS, aparelho, datas e software.')
      : 'Disponível apenas para MP4/MOV. Use “Exportar vídeo editado”.';
  }

  $('quickClean').addEventListener('click', async () => {
    const btn = $('quickClean'); const original = btn.innerHTML; btn.disabled = true; btn.textContent = 'Limpando…';
    try {
      const { blob, removedBlocks } = await VideoMeta.clean(state.file);
      const after = await VideoMeta.analyze(blob);
      const ext = (state.file.name.match(/\.[^.]+$/) || ['.mp4'])[0].toLowerCase();
      download(blob, outputName(ext));
      toast('Arquivo limpo baixado (' + removedBlocks + ' bloco(s) removido(s); ' + after.findings.length + ' item(ns) restante(s)). Vídeo e áudio intactos.');
    } catch (e) { toast('Erro ao limpar: ' + e.message, true); }
    btn.disabled = false; btn.innerHTML = original;
  });

  // ---------- carregar arquivo ----------

  function updateFileDetails() {
    if (!state.file) return;
    const parts = [fmtSize(state.file.size)];
    if (state.playable) {
      parts.push(video.videoWidth + '×' + video.videoHeight, fmtTime(dur()));
      const g = geometry(); parts.push('saída ' + g.ow + '×' + g.oh);
    } else parts.push('prévia indisponível');
    $('fileDetails').textContent = parts.join(' · ');
  }

  async function loadFile(file) {
    if (!file) return;
    if (state.exporting) return;
    ensureAudio(); // estamos dentro de um gesto do usuário: libera o AudioContext
    state.file = file; state.playable = false; state.redactions = [];
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    $('dropzone').hidden = true; $('workspace').hidden = false;
    $('fileName').textContent = file.name; $('fileDetails').textContent = fmtSize(file.size);
    $('metaList').innerHTML = '<div class="muted">Lendo metadados…</div>'; $('metaSummary').textContent = '';

    VideoMeta.analyze(file).then(renderMeta).catch((e) => {
      $('metaList').innerHTML = ''; const n = document.createElement('div'); n.className = 'meta-note';
      n.textContent = 'Não foi possível ler os metadados: ' + e.message; $('metaList').appendChild(n);
    });

    video.src = state.url;
    video.playbackRate = state.speed;
  }

  video.addEventListener('loadedmetadata', () => {
    state.playable = true;
    setTrim(0, dur());
    updateFileDetails();
  });
  video.addEventListener('loadeddata', renderPreview);
  video.addEventListener('error', () => {
    if (!state.file) return;
    state.playable = false;
    preview.width = 640; preview.height = 360;
    pctx.fillStyle = '#000'; pctx.fillRect(0, 0, 640, 360);
    pctx.fillStyle = '#fbf8f3'; pctx.font = '600 16px system-ui'; pctx.textAlign = 'center';
    pctx.fillText('O navegador não consegue reproduzir este codec (ex.: HEVC).', 320, 170);
    pctx.fillText('A limpeza de metadados sem re-codificação continua disponível.', 320, 196);
    updateFileDetails();
  });

  $('pickBtn').addEventListener('click', () => $('fileInput').click());
  $('pickBar').addEventListener('click', () => $('fileInput').click());
  document.querySelectorAll('.folder-grid .folder').forEach((c) => c.addEventListener('click', () => $('fileInput').click()));
  $('newFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });

  fillFormats();
})();
