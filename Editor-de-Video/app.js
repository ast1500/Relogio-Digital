/* app.js — legendas, cortes, velocidade e limpeza de metadados, tudo no navegador. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const preview = $('preview');
  const pctx = preview.getContext('2d');

  const PREVIEW_MAX = 1280;  // lado maior da prévia (a exportação usa a resolução cheia)
  const OUTPUT_MAX = 3840;
  const EXPORT_FPS = 30;
  const MIN_SEG = 0.1;       // menor trecho permitido, em segundos

  // ---------- fontes (arquivos locais: nada é baixado de servidores) ----------

  const FONTS = [
    { id: 'montserrat-900', name: 'Montserrat Black', family: 'EL Montserrat', weight: '900', file: 'montserrat-latin-900-normal.woff2' },
    { id: 'montserrat-700', name: 'Montserrat Bold', family: 'EL Montserrat', weight: '700', file: 'montserrat-latin-700-normal.woff2' },
    { id: 'poppins', name: 'Poppins ExtraBold', family: 'EL Poppins', weight: '800', file: 'poppins-latin-800-normal.woff2' },
    { id: 'archivo', name: 'Archivo Black', family: 'EL Archivo Black', weight: '400', file: 'archivo-black-latin-400-normal.woff2' },
    { id: 'anton', name: 'Anton', family: 'EL Anton', weight: '400', file: 'anton-latin-400-normal.woff2' },
    { id: 'bebas', name: 'Bebas Neue', family: 'EL Bebas Neue', weight: '400', file: 'bebas-neue-latin-400-normal.woff2' },
    { id: 'oswald', name: 'Oswald Bold', family: 'EL Oswald', weight: '700', file: 'oswald-latin-700-normal.woff2' },
    { id: 'bangers', name: 'Bangers (gibi)', family: 'EL Bangers', weight: '400', file: 'bangers-latin-400-normal.woff2' },
    { id: 'marker', name: 'Permanent Marker (pincel)', family: 'EL Permanent Marker', weight: '400', file: 'permanent-marker-latin-400-normal.woff2' },
    { id: 'system', name: 'Fonte do sistema', family: 'system-ui', weight: '800', file: null },
  ];
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const fontsReady = Promise.all(FONTS.filter((f) => f.file).map((f) => {
    if (typeof FontFace === 'undefined') return null;
    const face = new FontFace(f.family, 'url(fonts/' + f.file + ')', { weight: f.weight });
    document.fonts.add(face);
    return face.load().catch(() => null); // sem a fonte, cai na do sistema
  })).then(() => renderPreview());

  // ---------- estilos prontos ----------

  const PRESETS = [
    { name: 'Amarelo', font: 'montserrat-900', color: '#111111', upper: true, bgMode: 'box', bg: '#fcd94a', bgOpacity: 100, radius: 18, pad: 46, stroke: 0, strokeColor: '#000000', shadow: false },
    { name: 'Clássico', font: 'poppins', color: '#ffffff', upper: false, bgMode: 'none', bg: '#000000', bgOpacity: 70, radius: 10, pad: 24, stroke: 2, strokeColor: '#000000', shadow: true },
    { name: 'Por linha', font: 'poppins', color: '#111111', upper: false, bgMode: 'line', bg: '#ffffff', bgOpacity: 100, radius: 14, pad: 26, stroke: 0, strokeColor: '#000000', shadow: false },
    { name: 'Caixa preta', font: 'montserrat-700', color: '#ffffff', upper: false, bgMode: 'box', bg: '#000000', bgOpacity: 65, radius: 12, pad: 34, stroke: 0, strokeColor: '#000000', shadow: false },
    { name: 'Impacto', font: 'anton', color: '#ffd23f', upper: true, bgMode: 'none', bg: '#000000', bgOpacity: 70, radius: 10, pad: 24, stroke: 2, strokeColor: '#000000', shadow: true },
    { name: 'Rosa', font: 'archivo', color: '#ffffff', upper: true, bgMode: 'box', bg: '#ff4f7b', bgOpacity: 100, radius: 24, pad: 44, stroke: 0, strokeColor: '#000000', shadow: false },
    { name: 'Gibi', font: 'bangers', color: '#111111', upper: true, bgMode: 'box', bg: '#ffffff', bgOpacity: 100, radius: 6, pad: 34, stroke: 0, strokeColor: '#000000', shadow: true },
    { name: 'Pincel', font: 'marker', color: '#ffffff', upper: false, bgMode: 'line', bg: '#7b6cf6', bgOpacity: 100, radius: 8, pad: 28, stroke: 0, strokeColor: '#000000', shadow: false },
  ];
  const DEFAULT_STYLE = Object.assign({}, PRESETS[0], { size: 6.5, y: 78, width: 86 });
  delete DEFAULT_STYLE.name;

  function loadStyle() {
    try { const s = JSON.parse(localStorage.getItem('editor-limpo-estilo')); if (s && typeof s === 'object') return Object.assign({}, DEFAULT_STYLE, s); } catch (e) { /* sem armazenamento */ }
    return Object.assign({}, DEFAULT_STYLE);
  }
  function saveStyle() { try { localStorage.setItem('editor-limpo-estilo', JSON.stringify(state.style)); } catch (e) { /* ignora */ } }

  const state = {
    file: null, url: null, playable: false,
    segments: [], selSeg: -1,          // trechos que FICAM no vídeo (tempo do original)
    captions: [], nextCapId: 1,        // { id, text, s, e } no tempo do original
    style: loadStyle(),
    speed: 1, volume: 100, mute: false,
    exporting: false, cancel: false,
  };

  // ---------- utilidades ----------

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
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
    return state.file.name.replace(/\.[^.]+$/, '') + '-editado' + ext;
  }
  const dur = () => (isFinite(video.duration) ? video.duration : 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- áudio ----------

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

  // ---------- desenho da legenda ----------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = line + ' ' + words[i];
        if (ctx.measureText(test).width <= maxW) line = test; else { out.push(line); line = words[i]; }
      }
      out.push(line);
    }
    return out;
  }

  function drawCaption(ctx, W, H, rawText) {
    const st = state.style;
    const text = st.upper ? rawText.toLocaleUpperCase('pt-BR') : rawText;
    if (!text.trim()) return;
    const f = fontById(st.font);
    const fontPx = Math.round(H * st.size / 100);
    ctx.save();
    ctx.font = f.file
      ? f.weight + ' ' + fontPx + 'px "' + f.family + '", system-ui, sans-serif'
      : f.weight + ' ' + fontPx + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    const hasBg = st.bgMode !== 'none';
    const padX = hasBg ? fontPx * st.pad / 100 : 0;
    const padY = hasBg ? fontPx * st.pad / 100 * 0.62 : 0;
    const maxW = Math.max(fontPx * 2, W * st.width / 100 - padX * 2);
    const lines = wrapLines(ctx, text, maxW);
    const lineH = fontPx * 1.16;
    const capH = ctx.measureText('H').actualBoundingBoxAscent || fontPx * 0.7;
    const widths = lines.map((l) => Math.min(maxW, ctx.measureText(l).width));
    const blockH = lines.length * lineH + padY * 2;
    const cy = clamp(H * st.y / 100, blockH / 2 + 4, H - blockH / 2 - 4);
    const top = cy - blockH / 2;
    const radius = fontPx * st.radius / 50;
    const strokeW = st.stroke === 2 ? fontPx * 0.17 : st.stroke === 1 ? fontPx * 0.09 : 0;
    const shadow = () => { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = fontPx * 0.18; ctx.shadowOffsetY = fontPx * 0.06; };
    const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };

    // fundo atrás das letras
    if (hasBg) {
      ctx.fillStyle = hexToRgba(st.bg, st.bgOpacity / 100);
      if (st.shadow) shadow();
      if (st.bgMode === 'box') {
        const bw = Math.max(...widths) + padX * 2;
        roundRect(ctx, W / 2 - bw / 2, top, bw, blockH, radius); ctx.fill();
      } else {
        const lh = lineH + padY * 0.9;
        lines.forEach((l, i) => {
          if (!l) return;
          const bw = widths[i] + padX * 2, ly = top + padY + i * lineH + lineH / 2 - lh / 2;
          roundRect(ctx, W / 2 - bw / 2, ly, bw, lh, Math.min(radius, lh / 2)); ctx.fill();
        });
      }
      noShadow();
    }

    // texto
    lines.forEach((l, i) => {
      const baseY = top + padY + i * lineH + lineH / 2 + capH / 2;
      if (strokeW) {
        ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = strokeW; ctx.strokeStyle = st.strokeColor;
        if (st.shadow && !hasBg) shadow();
        ctx.strokeText(l, W / 2, baseY, maxW); noShadow();
      } else if (st.shadow && !hasBg) shadow();
      ctx.fillStyle = st.color; ctx.fillText(l, W / 2, baseY, maxW); noShadow();
    });
    ctx.restore();
  }

  function activeCaption(t) {
    let best = null;
    for (const c of state.captions) if (t >= c.s && t < c.e && (!best || c.s >= best.s)) best = c;
    return best;
  }

  function drawFrame(ctx, W, H) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
    const c = activeCaption(video.currentTime);
    if (c) drawCaption(ctx, W, H, c.text);
  }

  function outputSize() {
    const w = video.videoWidth || 1280, h = video.videoHeight || 720;
    const k = Math.min(1, OUTPUT_MAX / Math.max(w, h));
    return { w: Math.max(2, Math.round(w * k / 2) * 2), h: Math.max(2, Math.round(h * k / 2) * 2) };
  }

  function renderPreview() {
    if (!state.file || !state.playable) return;
    const o = outputSize();
    const k = Math.min(1, PREVIEW_MAX / Math.max(o.w, o.h));
    const W = Math.round(o.w * k), H = Math.round(o.h * k);
    if (preview.width !== W || preview.height !== H) { preview.width = W; preview.height = H; }
    drawFrame(pctx, W, H);
    updateTimeUI();
  }

  // ---------- reprodução respeitando os cortes ----------

  const segAt = (t) => state.segments.findIndex((g) => t >= g.s - 0.001 && t < g.e - 0.001);

  let rafId = 0;
  function loop() {
    if (!state.exporting && !video.paused && !video.seeking) {
      const t = video.currentTime;
      const i = segAt(t);
      if (i === -1 || t >= state.segments[i].e - 0.04) {
        const next = state.segments.find((g) => g.s > t + 0.001);
        if (next) video.currentTime = next.s;
        else { video.pause(); video.currentTime = state.segments[0].s; }
      }
    }
    if (!state.exporting) renderPreview();
    rafId = video.paused ? 0 : requestAnimationFrame(loop);
  }
  const kick = () => { if (!rafId) rafId = requestAnimationFrame(loop); };

  function togglePlay() {
    if (!state.playable || state.exporting) return;
    ensureAudio();
    if (video.paused) {
      if (segAt(video.currentTime) === -1) {
        const next = state.segments.find((g) => g.s > video.currentTime);
        video.currentTime = (next || state.segments[0]).s;
      }
      video.playbackRate = state.speed;
      video.play().catch((err) => toast('Não foi possível reproduzir: ' + err.message, true));
    } else video.pause();
  }
  $('playBtn').addEventListener('click', togglePlay);
  video.addEventListener('play', kick);
  video.addEventListener('pause', renderPreview);
  video.addEventListener('seeked', () => { if (!state.exporting) renderPreview(); });
  $('seek').addEventListener('input', (e) => { video.currentTime = e.target.value / 1000 * dur(); });

  // ---------- linha do tempo / cortes ----------

  function finalDuration() { return state.segments.reduce((a, g) => a + g.e - g.s, 0) / state.speed; }

  function renderTrack() {
    const d = dur() || 1;
    const lv = $('laneVideo'); lv.innerHTML = '';
    state.segments.forEach((g, i) => {
      const b = document.createElement('div');
      b.className = 'seg-block' + (i === state.selSeg ? ' sel' : '');
      b.style.left = (g.s / d * 100) + '%'; b.style.width = ((g.e - g.s) / d * 100) + '%';
      b.innerHTML = '<span>' + fmtTime(g.e - g.s) + '</span>';
      lv.appendChild(b);
    });
    const lc = $('laneCaps'); lc.innerHTML = '';
    state.captions.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cap-bar'; b.dataset.id = c.id; b.title = c.text;
      b.style.left = (c.s / d * 100) + '%'; b.style.width = Math.max(0.6, (c.e - c.s) / d * 100) + '%';
      b.textContent = c.text;
      lc.appendChild(b);
    });
    const n = state.segments.length;
    $('cutInfo').textContent = 'Duração final: ' + fmtTime(finalDuration()) +
      (n > 1 ? ' · ' + n + ' trechos' : '') + (state.speed !== 1 ? ' · a ' + String(state.speed).replace('.', ',') + '×' : '');
    $('removeSegBtn').disabled = state.selSeg < 0 || n < 2;
    updateTimeUI();
  }

  function updateTimeUI() {
    const d = dur(), t = video.currentTime;
    $('timeLabel').textContent = fmtTime(t) + ' / ' + fmtTime(d);
    if (document.activeElement !== $('seek')) $('seek').value = d ? Math.round(t / d * 1000) : 0;
    $('trackCursor').style.left = (d ? t / d * 100 : 0) + '%';
    $('playBtn').textContent = video.paused ? '▶' : '❚❚';
    const ac = activeCaption(t);
    document.querySelectorAll('.cap-row').forEach((r) => r.classList.toggle('active', !!ac && r.dataset.id === String(ac.id)));
    document.querySelectorAll('.cap-bar').forEach((r) => r.classList.toggle('active', !!ac && r.dataset.id === String(ac.id)));
  }

  function split() {
    const t = video.currentTime, i = segAt(t);
    if (i === -1) return toast('A posição atual está num trecho removido.', true);
    const g = state.segments[i];
    if (t - g.s < MIN_SEG || g.e - t < MIN_SEG) return toast('Muito perto da borda do trecho. Mova um pouco a posição.', true);
    state.segments.splice(i, 1, { s: g.s, e: t }, { s: t, e: g.e });
    state.selSeg = i + 1;
    renderTrack();
    toast('Trecho dividido. Toque num trecho da linha do tempo para selecioná-lo e removê-lo.');
  }
  function removeSeg() {
    if (state.selSeg < 0) return toast('Toque num trecho da linha do tempo para selecioná-lo.', true);
    if (state.segments.length < 2) return toast('Precisa sobrar pelo menos um trecho.', true);
    const g = state.segments[state.selSeg];
    state.segments.splice(state.selSeg, 1);
    state.selSeg = Math.min(state.selSeg, state.segments.length - 1);
    const next = state.segments.find((x) => x.s >= g.e) || state.segments[state.segments.length - 1];
    video.currentTime = next.s;
    renderTrack();
  }
  $('splitBtn').addEventListener('click', split);
  $('removeSegBtn').addEventListener('click', removeSeg);
  $('resetCutsBtn').addEventListener('click', () => { state.segments = [{ s: 0, e: dur() }]; state.selSeg = 0; renderTrack(); });

  $('track').addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.cap-bar');
    if (bar) { selectCaption(Number(bar.dataset.id)); return; }
    const track = e.currentTarget, rect = track.getBoundingClientRect(), d = dur(); if (!d) return;
    const tAt = (x) => clamp((x - rect.left) / rect.width * d, 0, d);
    const t0 = tAt(e.clientX);
    state.selSeg = segAt(t0);
    video.currentTime = t0; renderTrack();
    track.setPointerCapture(e.pointerId);
    const move = (ev) => { video.currentTime = tAt(ev.clientX); };
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
  });

  // ---------- legendas ----------

  function sortCaptions() { state.captions.sort((a, b) => a.s - b.s); }

  function renderCaptionList() {
    const list = $('capList'); list.innerHTML = '';
    if (!state.captions.length) {
      list.innerHTML = '<div class="cap-empty">Vá até o momento em que a fala começa e toque em <b>Adicionar no ponto atual</b>. Também dá para importar um arquivo .srt.</div>';
    }
    state.captions.forEach((c, idx) => {
      const row = document.createElement('div');
      row.className = 'cap-row'; row.dataset.id = c.id;
      row.innerHTML =
        '<div class="cap-head">' +
          '<button type="button" class="cap-num" title="Ir para esta legenda">' + (idx + 1) + '</button>' +
          '<label class="cap-time">de <input type="number" step="0.1" min="0" data-k="s" value="' + c.s.toFixed(1) + '"></label>' +
          '<button type="button" class="mini" data-set="s" title="Usar a posição atual como início"><svg class="ic sm"><use href="#i-clock"/></svg></button>' +
          '<label class="cap-time">até <input type="number" step="0.1" min="0" data-k="e" value="' + c.e.toFixed(1) + '"></label>' +
          '<button type="button" class="mini" data-set="e" title="Usar a posição atual como fim"><svg class="ic sm"><use href="#i-clock"/></svg></button>' +
          '<button type="button" class="mini danger" data-del title="Apagar legenda"><svg class="ic sm"><use href="#i-trash"/></svg></button>' +
        '</div>' +
        '<textarea rows="2" placeholder="Digite a legenda">' + esc(c.text) + '</textarea>';
      list.appendChild(row);
    });
    const n = state.captions.length;
    $('capInfo').textContent = n ? n + (n === 1 ? ' legenda' : ' legendas') : 'Nenhuma legenda ainda';
    $('exportSrtBtn').disabled = !n;
    renderTrack();
  }

  const capById = (id) => state.captions.find((c) => c.id === id);

  $('capList').addEventListener('input', (e) => {
    const row = e.target.closest('.cap-row'); if (!row || e.target.tagName !== 'TEXTAREA') return;
    const c = capById(Number(row.dataset.id));
    c.text = e.target.value;
    const bar = document.querySelector('.cap-bar[data-id="' + c.id + '"]'); if (bar) { bar.textContent = c.text; bar.title = c.text; }
    renderPreview();
  });
  $('capList').addEventListener('change', (e) => {
    const row = e.target.closest('.cap-row'); if (!row || !e.target.dataset.k) return;
    setCapTime(capById(Number(row.dataset.id)), e.target.dataset.k, parseFloat(e.target.value) || 0);
  });
  function setCapTime(c, k, v) {
    v = clamp(v, 0, dur());
    if (k === 's') c.s = Math.max(0, Math.min(v, c.e - MIN_SEG)); else c.e = Math.min(dur(), Math.max(v, c.s + MIN_SEG));
    sortCaptions(); renderCaptionList(); renderPreview();
  }
  $('capList').addEventListener('click', (e) => {
    const row = e.target.closest('.cap-row'); if (!row) return;
    const c = capById(Number(row.dataset.id));
    const setBtn = e.target.closest('[data-set]');
    if (setBtn) { setCapTime(c, setBtn.dataset.set, video.currentTime); return; }
    if (e.target.closest('[data-del]')) { state.captions = state.captions.filter((x) => x !== c); renderCaptionList(); renderPreview(); return; }
    if (e.target.closest('.cap-num')) video.currentTime = c.s + 0.01;
  });
  $('capList').addEventListener('focusin', (e) => {
    if (e.target.tagName !== 'TEXTAREA') return;
    const c = capById(Number(e.target.closest('.cap-row').dataset.id));
    if (video.paused && (video.currentTime < c.s || video.currentTime >= c.e)) video.currentTime = c.s + 0.01;
  });

  function selectCaption(id) {
    const c = capById(id); if (!c) return;
    video.currentTime = c.s + 0.01;
    const ta = document.querySelector('.cap-row[data-id="' + id + '"] textarea');
    if (ta) { ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); ta.focus({ preventScroll: true }); }
  }

  $('addCapBtn').addEventListener('click', () => {
    if (!state.playable) return;
    const t = video.currentTime;
    const next = state.captions.find((c) => c.s > t + MIN_SEG); // termina onde a próxima começa
    const e = Math.min(dur(), t + 2.5, next ? next.s : Infinity);
    if (e - t < MIN_SEG) return toast('Não há espaço para uma legenda aqui.', true);
    const c = { id: state.nextCapId++, text: '', s: t, e };
    state.captions.push(c); sortCaptions(); renderCaptionList();
    const ta = document.querySelector('.cap-row[data-id="' + c.id + '"] textarea');
    if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); }
  });

  // SRT: importar e exportar
  function parseTime(s) {
    const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/); if (!m) return NaN;
    return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + m[4]);
  }
  function parseSrt(text) {
    const out = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n'); const i = lines.findIndex((l) => l.includes('-->'));
      if (i === -1) continue;
      const [a, b] = lines[i].split('-->');
      const s = parseTime(a), e = parseTime(b);
      const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').trim();
      if (isFinite(s) && isFinite(e) && e > s && txt) out.push({ s, e, text: txt });
    }
    return out;
  }
  $('importSrtBtn').addEventListener('click', () => $('srtInput').click());
  $('srtInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const items = parseSrt(await f.text());
    if (!items.length) return toast('Não encontrei legendas nesse arquivo.', true);
    let n = 0;
    for (const it of items) {
      if (it.s >= dur()) continue;
      state.captions.push({ id: state.nextCapId++, text: it.text, s: it.s, e: Math.min(it.e, dur()) }); n++;
    }
    sortCaptions(); renderCaptionList(); renderPreview();
    toast(n + ' legenda(s) importada(s).');
  });

  // Converte um intervalo do original para o vídeo final (descontando cortes e velocidade).
  function toOutputRange(s, e) {
    let acc = 0, first = null, last = null;
    for (const g of state.segments) {
      const a = Math.max(s, g.s), b = Math.min(e, g.e);
      if (b > a) { if (first === null) first = acc + (a - g.s); last = acc + (b - g.s); }
      acc += g.e - g.s;
    }
    return first === null ? null : [first / state.speed, last / state.speed];
  }
  function srtTime(t) {
    const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0');
  }
  $('exportSrtBtn').addEventListener('click', () => {
    let n = 0; const parts = [];
    for (const c of state.captions) {
      const r = toOutputRange(c.s, c.e); if (!r || !c.text.trim()) continue;
      parts.push(++n + '\n' + srtTime(r[0]) + ' --> ' + srtTime(r[1]) + '\n' + c.text.trim() + '\n');
    }
    if (!n) return toast('Nenhuma legenda cai nos trechos que ficam no vídeo.', true);
    download(new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' }), outputName('.srt'));
  });

  // ---------- painel de estilo ----------

  const fontSel = $('stFont');
  FONTS.forEach((f) => {
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.name;
    o.style.fontFamily = f.file ? '"' + f.family + '"' : 'system-ui'; o.style.fontWeight = f.weight;
    fontSel.appendChild(o);
  });

  const presetsEl = $('presets');
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset'; b.dataset.i = i;
    const f = fontById(p.font);
    const bg = p.bgMode === 'none' ? 'transparent' : hexToRgba(p.bg, p.bgOpacity / 100);
    const stroke = p.stroke ? '-webkit-text-stroke:' + (p.stroke * 1.5) + 'px ' + p.strokeColor + ';paint-order:stroke fill;' : '';
    b.innerHTML = '<span class="preset-sample" style="font-family:\'' + f.family + '\',system-ui;font-weight:' + f.weight + ';color:' + p.color +
      ';background:' + bg + ';' + stroke + 'border-radius:' + Math.round(p.radius / 3) + 'px">' + (p.upper ? 'ABC' : 'Abc') + '</span>' +
      '<span class="preset-name">' + p.name + '</span>';
    presetsEl.appendChild(b);
  });
  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.preset'); if (!b) return;
    const p = Object.assign({}, PRESETS[Number(b.dataset.i)]); delete p.name;
    Object.assign(state.style, p); styleChanged();
  });

  const RANGES = [
    ['stSize', 'size', (v) => String(v).replace('.', ',') + '%'],
    ['stBgOpacity', 'bgOpacity', (v) => v + '%'],
    ['stRadius', 'radius', (v) => v],
    ['stPad', 'pad', (v) => v],
    ['stY', 'y', (v) => v + '%'],
    ['stWidth', 'width', (v) => v + '%'],
  ];
  const COLORS = [['stColor', 'color'], ['stBg', 'bg'], ['stStrokeColor', 'strokeColor']];

  function syncStyleUI() {
    const st = state.style;
    fontSel.value = st.font;
    RANGES.forEach(([id, k, fmt]) => { $(id).value = st[k]; $(id + 'Out').textContent = fmt(st[k]); });
    COLORS.forEach(([id, k]) => { $(id).value = st[k]; });
    $('stUpper').checked = !!st.upper; $('stShadow').checked = !!st.shadow;
    $('stBgMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.bgMode));
    $('stStroke').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === st.stroke));
    $('bgOpts').classList.toggle('disabled', st.bgMode === 'none');
    presetsEl.querySelectorAll('.preset').forEach((b) => {
      const p = PRESETS[Number(b.dataset.i)];
      b.classList.toggle('on', ['font', 'color', 'upper', 'bgMode', 'bg', 'stroke'].every((k) => p[k] === st[k]));
    });
  }
  function styleChanged() { saveStyle(); syncStyleUI(); renderPreview(); }

  fontSel.addEventListener('change', () => { state.style.font = fontSel.value; styleChanged(); });
  RANGES.forEach(([id, k, fmt]) => $(id).addEventListener('input', (e) => {
    state.style[k] = Number(e.target.value); $(id + 'Out').textContent = fmt(state.style[k]); saveStyle(); renderPreview();
  }));
  COLORS.forEach(([id, k]) => $(id).addEventListener('input', (e) => { state.style[k] = e.target.value; styleChanged(); }));
  $('stUpper').addEventListener('change', (e) => { state.style.upper = e.target.checked; styleChanged(); });
  $('stShadow').addEventListener('change', (e) => { state.style.shadow = e.target.checked; styleChanged(); });
  $('stBgMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.style.bgMode = b.dataset.v; styleChanged(); } });
  $('stStroke').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.style.stroke = Number(b.dataset.v); styleChanged(); } });

  // ---------- velocidade e áudio ----------

  function syncSpeedUI() { $('speedSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === state.speed)); }
  $('speedSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.speed = Number(b.dataset.v); video.playbackRate = state.speed; syncSpeedUI(); renderTrack();
  });
  $('volume').addEventListener('input', (e) => { state.volume = Number(e.target.value); $('volumeOut').textContent = state.volume + '%'; applyVolume(); });
  $('mute').addEventListener('change', (e) => { state.mute = e.target.checked; applyVolume(); });

  // ---------- atalhos ----------

  document.addEventListener('keydown', (e) => {
    if (!state.file || state.exporting) return;
    const el = document.activeElement;
    if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && el.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's' || e.key === 'S') split();
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); $('addCapBtn').click(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSeg(); }
    else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 5 : 1 / 30));
    else if (e.key === 'ArrowRight') video.currentTime = Math.min(dur(), video.currentTime + (e.shiftKey ? 5 : 1 / 30));
  });

  // ---------- exportação ----------

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
    const seen = new Set();
    for (const [mime, label, ext] of FORMAT_CANDIDATES) {
      if (!MediaRecorder.isTypeSupported(mime) || seen.has(label)) continue;
      if (label.startsWith('MP4 (codec') && seen.has('MP4 (H.264 + AAC)')) continue;
      if (label === 'WebM' && (seen.has('WebM (VP9 + Opus)') || seen.has('WebM (VP8 + Opus)'))) continue;
      seen.add(label);
      const o = document.createElement('option'); o.value = mime; o.textContent = label; o.dataset.ext = ext; sel.appendChild(o);
    }
    if (!sel.options.length) { sel.innerHTML = '<option>Nenhum formato suportado</option>'; $('exportBtn').disabled = true; }
  }

  const waitEvent = (el, name) => new Promise((res) => el.addEventListener(name, res, { once: true }));
  async function seekTo(t) { if (Math.abs(video.currentTime - t) < 0.001) return; video.currentTime = t; await waitEvent(video, 'seeked'); }
  function setUiLocked(locked) {
    document.querySelectorAll('.tools button, .tools select, .tools input, .stage .panel button, .stage .panel input, .stage .panel textarea').forEach((el) => {
      if (locked) { el.dataset.wasDisabled = el.disabled; el.disabled = true; } else el.disabled = el.dataset.wasDisabled === 'true';
    });
  }

  async function exportVideo() {
    if (!state.playable) return toast('O navegador não consegue decodificar este vídeo, então não dá para exportar com edições. Use “Limpar sem editar”.', true);
    const opt = $('format').selectedOptions[0]; if (!opt) return;
    await fontsReady;
    const a = ensureAudio();
    const o = outputSize();
    const canvas = document.createElement('canvas'); canvas.width = o.w; canvas.height = o.h;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(EXPORT_FPS);
    if (!state.mute && a) a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: opt.value, videoBitsPerSecond: Number($('quality').value), audioBitsPerSecond: 160000 });
    } catch (e) { return toast('Falha ao iniciar o gravador: ' + e.message, true); }

    state.exporting = true; state.cancel = false; setUiLocked(true);
    $('exportOverlay').hidden = false; $('exportBar').style.width = '0%'; $('exportStatus').textContent = 'Preparando…';
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = waitEvent(rec, 'stop');
    video.pause();
    if (a) a.monitor.gain.value = 0; // não toca o áudio nas caixas de som durante a exportação
    video.playbackRate = state.speed;

    const total = state.segments.reduce((s, g) => s + g.e - g.s, 0);
    let done = 0;
    try {
      // Grava trecho por trecho; entre um e outro o gravador fica pausado, então os cortes não deixam buracos.
      for (let i = 0; i < state.segments.length && !state.cancel; i++) {
        const g = state.segments[i];
        await seekTo(g.s);
        drawFrame(ctx, o.w, o.h);
        if (rec.state === 'inactive') rec.start(1000); else rec.resume();
        await video.play();
        await new Promise((resolve) => {
          let finished = false;
          const finish = () => { if (!finished) { finished = true; resolve(); } };
          const useVfc = 'requestVideoFrameCallback' in video;
          const step = () => {
            if (finished) return;
            const t = video.currentTime;
            drawFrame(ctx, o.w, o.h);
            const p = clamp((done + Math.max(0, t - g.s)) / total, 0, 1);
            $('exportBar').style.width = (p * 100).toFixed(1) + '%';
            $('exportStatus').textContent = 'Exportando… ' + Math.round(p * 100) + '% (mantenha esta aba aberta e visível)';
            if (state.cancel || video.ended || t >= g.e) return finish();
            if (useVfc) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
          };
          video.addEventListener('ended', finish, { once: true });
          step();
        });
        video.pause();
        if (rec.state === 'recording') rec.pause();
        done += g.e - g.s;
      }
    } catch (e) { state.cancel = true; toast('Falha na exportação: ' + e.message, true); }

    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    if (a) a.monitor.gain.value = 1;
    state.exporting = false; setUiLocked(false);
    $('exportOverlay').hidden = true;
    renderTrack(); renderPreview();
    if (state.cancel) return toast('Exportação cancelada.');

    let blob = new Blob(chunks, { type: opt.value.split(';')[0] });
    if (opt.dataset.ext === '.mp4') { try { blob = (await VideoMeta.clean(blob)).blob; } catch (e) { /* mantém */ } }
    download(blob, outputName(opt.dataset.ext));
    toast('Pronto! ' + fmtSize(blob.size) + ' com legendas e sem metadados.');
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
    $('metaSummary').innerHTML = f.length
      ? '<span class="chip">' + f.length + ' encontrados</span>' + (high ? '<span class="chip hot">' + high + ' sensíveis</span>' : '')
      : '';
    if (result.format === 'unknown') {
      list.innerHTML = '<div class="meta-note">Formato não reconhecido para leitura. A exportação gera um arquivo limpo mesmo assim.</div>';
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
      where.textContent = x.category + ' · ' + x.where + (x.removable ? '' : ' · só sai na exportação');
      body.append(label, value, where);
      const st = CAT_STYLE[x.category] || CAT_STYLE.Outros;
      row.append(iconTile(st[0], st[1]), body, sev); list.appendChild(row);
    }
    if (result.format === 'webm') {
      const n = document.createElement('div'); n.className = 'meta-note';
      n.textContent = 'Para WebM/MKV, a limpeza acontece na exportação.';
      list.appendChild(n);
    }
    $('quickClean').disabled = !result.cleanable;
    $('quickCleanHint').textContent = result.cleanable
      ? 'Baixa o vídeo original, com a mesma qualidade, sem os metadados. Legendas e cortes não entram aqui: para isso, use Exportar.'
      : 'Disponível só para MP4/MOV. Use “Exportar vídeo”, que também remove tudo.';
  }

  $('quickClean').addEventListener('click', async () => {
    const btn = $('quickClean'); const original = btn.innerHTML; btn.disabled = true; btn.textContent = 'Limpando…';
    try {
      const { blob, removedBlocks } = await VideoMeta.clean(state.file);
      const after = await VideoMeta.analyze(blob);
      const ext = (state.file.name.match(/\.[^.]+$/) || ['.mp4'])[0].toLowerCase();
      download(blob, outputName(ext));
      toast('Arquivo limpo baixado (' + removedBlocks + ' bloco(s) removido(s), ' + after.findings.length + ' restante(s)).');
    } catch (e) { toast('Erro ao limpar: ' + e.message, true); }
    btn.disabled = false; btn.innerHTML = original;
  });

  // ---------- carregar arquivo ----------

  function updateFileDetails() {
    if (!state.file) return;
    const parts = [fmtSize(state.file.size)];
    if (state.playable) parts.push(video.videoWidth + '×' + video.videoHeight, fmtTime(dur()));
    else parts.push('prévia indisponível');
    $('fileDetails').textContent = parts.join(' · ');
  }

  function loadFile(file) {
    if (!file || state.exporting) return;
    ensureAudio(); // estamos dentro de um gesto do usuário: libera o AudioContext
    state.file = file; state.playable = false; state.captions = []; state.segments = []; state.selSeg = -1;
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    $('dropzone').hidden = true; $('workspace').hidden = false;
    $('fileName').textContent = file.name; $('fileDetails').textContent = fmtSize(file.size);
    $('metaList').innerHTML = '<div class="sub">Lendo metadados…</div>'; $('metaSummary').innerHTML = '';
    renderCaptionList();
    VideoMeta.analyze(file).then(renderMeta).catch((e) => {
      $('metaList').innerHTML = ''; const n = document.createElement('div'); n.className = 'meta-note';
      n.textContent = 'Não foi possível ler os metadados: ' + e.message; $('metaList').appendChild(n);
    });
    video.src = state.url;
    video.playbackRate = state.speed;
  }

  video.addEventListener('loadedmetadata', () => {
    state.playable = true;
    state.segments = [{ s: 0, e: dur() }]; state.selSeg = 0;
    updateFileDetails(); renderTrack();
  });
  video.addEventListener('loadeddata', renderPreview);
  video.addEventListener('error', () => {
    if (!state.file) return;
    state.playable = false;
    preview.width = 640; preview.height = 360;
    pctx.fillStyle = '#000'; pctx.fillRect(0, 0, 640, 360);
    pctx.fillStyle = '#fbf8f3'; pctx.font = '600 16px system-ui'; pctx.textAlign = 'center';
    pctx.fillText('O navegador não consegue reproduzir este codec (ex.: HEVC).', 320, 170);
    pctx.fillText('A limpeza de metadados continua disponível.', 320, 196);
    updateFileDetails();
  });

  $('pickBtn').addEventListener('click', () => $('fileInput').click());
  $('pickBar').addEventListener('click', () => $('fileInput').click());
  $('newFile').addEventListener('click', () => $('fileInput').click());
  document.querySelectorAll('.folder-grid .folder').forEach((c) => c.addEventListener('click', () => $('fileInput').click()));
  $('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });

  fillFormats(); syncStyleUI(); syncSpeedUI();
})();
