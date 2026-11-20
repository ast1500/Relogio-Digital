/*
 * schedule.js — regras do agendamento em massa (sem tela e sem rede, para poder testar no Node):
 * hashtags, legendas com modelo, distribuição de datas, validações e planilha CSV.
 * Navegador: window.Agenda · Node: module.exports
 */
(function (root) {
  'use strict';

  const MIN_LEAD_MIN = 10;            // o Facebook exige pelo menos 10 minutos no futuro
  const VIDEO_MAX_MONTHS = 6;         // vídeos de Página: até 6 meses
  const REEL_MAX_DAYS = 29;           // Reels: janela menor (valor conservador; conferir na doc da Meta)
  const REEL_MAX_SECONDS = 90;
  const HASHTAG_SOFT_LIMIT = 5;

  // ---------- hashtags e legenda ----------

  /** "viagem, #Praia  ferias #praia" → ["#viagem", "#Praia", "#ferias"] (sem repetir, ignora maiúsculas). */
  function normalizeHashtags(input) {
    const out = [], seen = new Set();
    for (let raw of String(input || '').split(/[\s,;]+/)) {
      raw = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
      if (!raw) continue;
      const key = raw.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) continue;
      seen.add(key); out.push('#' + raw);
    }
    return out;
  }

  /** Texto final do post: legenda + linha em branco + hashtags. */
  function buildDescription(caption, hashtags) {
    const c = String(caption || '').trim();
    const tags = normalizeHashtags(hashtags).join(' ');
    return c && tags ? c + '\n\n' + tags : c || tags;
  }

  /** Modelo de legenda: {n}, {total}, {nome}, {data}, {hora}. */
  function applyTemplate(template, ctx) {
    const d = ctx.when instanceof Date && !isNaN(ctx.when) ? ctx.when : null;
    return String(template || '').replace(/\{(n|total|nome|data|hora)\}/gi, (_, k) => {
      switch (k.toLowerCase()) {
        case 'n': return String(ctx.n ?? '');
        case 'total': return String(ctx.total ?? '');
        case 'nome': return String(ctx.nome ?? '').replace(/\.[^.]+$/, '');
        case 'data': return d ? fmtDate(d) : '';
        case 'hora': return d ? fmtTime(d) : '';
      }
      return '';
    });
  }

  // ---------- datas ----------

  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /** Valor para <input type="datetime-local"> (hora local). */
  function toLocalInput(d) { return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + fmtTime(d) : ''; }
  function fromLocalInput(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }

  /** "12:00, 19h, 8:30" → [[8,30],[12,0],[19,0]] (ordenado, sem repetir). */
  function parseTimes(input) {
    const set = new Map();
    for (const part of String(input || '').split(/[\s,;]+/)) {
      const m = /^(\d{1,2})(?:[:hH](\d{2})?)?h?$/.exec(part.trim());
      if (!m) continue;
      const h = +m[1], mi = +(m[2] || 0);
      if (h > 23 || mi > 59) continue;
      set.set(h * 60 + mi, [h, mi]);
    }
    return [...set.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }

  /**
   * Distribui `count` horários a partir de `start` (dia), nos `times` de cada dia permitido em `weekdays`
   * (0 = domingo … 6 = sábado). Pula horários antes de `notBefore` (por padrão, agora + 15 min).
   */
  function distribute(count, { start, times, weekdays, notBefore } = {}) {
    const slots = Array.isArray(times) ? times : parseTimes(times);
    const days = new Set(weekdays && weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6]);
    if (!slots.length || count <= 0) return [];
    const min = notBefore || new Date(Date.now() + 15 * 60000);
    const day = new Date(start || Date.now()); day.setHours(0, 0, 0, 0);
    const out = [];
    for (let guard = 0; out.length < count && guard < 3660; guard++) {
      if (days.has(day.getDay())) {
        for (const [h, m] of slots) {
          const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
          if (d >= min) out.push(d);
          if (out.length >= count) break;
        }
      }
      day.setDate(day.getDate() + 1);
    }
    return out;
  }

  function maxDate(kind, now) {
    const d = new Date(now);
    if (kind === 'reel') d.setDate(d.getDate() + REEL_MAX_DAYS);
    else d.setMonth(d.getMonth() + VIDEO_MAX_MONTHS);
    return d;
  }

  // ---------- tipo e validação ----------

  /** Reel quando é vertical e curto; senão, vídeo normal. */
  function autoKind(meta) {
    if (!meta || !meta.width || !meta.height) return 'video';
    return meta.height > meta.width && meta.duration > 0 && meta.duration <= REEL_MAX_SECONDS ? 'reel' : 'video';
  }

  /**
   * Problemas de uma linha da fila. Erros bloqueiam o envio daquele vídeo; avisos, não.
   * row: { kind, when, caption, hashtags, meta }   others: as outras linhas (para horários repetidos)
   */
  function validate(row, now = new Date(), others = []) {
    const issues = [];
    const err = (msg) => issues.push({ level: 'error', msg });
    const warn = (msg) => issues.push({ level: 'warn', msg });
    const when = row.when;
    if (!(when instanceof Date) || isNaN(when)) err('Escolha a data e a hora.');
    else {
      if (when.getTime() < now.getTime() + MIN_LEAD_MIN * 60000) err('O horário precisa ser pelo menos 10 minutos no futuro.');
      if (when > maxDate(row.kind, now)) err(row.kind === 'reel' ? 'Reels podem ser agendados para até ' + REEL_MAX_DAYS + ' dias.' : 'Vídeos podem ser agendados para até 6 meses.');
      if (others.some((o) => o !== row && o.when instanceof Date && o.when.getTime() === when.getTime())) warn('Outro vídeo está no mesmo horário.');
    }
    if (row.kind === 'reel' && row.meta && row.meta.width) {
      if (row.meta.height <= row.meta.width) err('Reels precisam ser verticais. Envie como vídeo.');
      else if (row.meta.duration > REEL_MAX_SECONDS) err('Reels podem ter até ' + REEL_MAX_SECONDS + ' segundos. Envie como vídeo.');
    }
    if (!String(row.caption || '').trim() && !normalizeHashtags(row.hashtags).length) warn('Sem legenda.');
    if (normalizeHashtags(row.hashtags).length > HASHTAG_SOFT_LIMIT) warn('Mais de ' + HASHTAG_SOFT_LIMIT + ' hashtags: no Facebook, poucas funcionam melhor.');
    return issues;
  }

  // ---------- listas para sortear (legendas e hashtags) ----------

  /**
   * Lista de legendas digitada pela pessoa. Se houver linha em branco, ela separa as legendas
   * (assim cada legenda pode ter várias linhas); senão, cada linha é uma legenda.
   */
  function parseCaptionPool(text) {
    const t = String(text || '').replace(/\r/g, '').trim();
    if (!t) return [];
    const parts = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  /** Embaralha (Fisher–Yates) sem alterar o original. */
  function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /**
   * Sorteia `count` itens da lista sem repetir até usar todos (como tirar papéis de um saco),
   * e evita o mesmo item duas vezes seguidas quando a lista é renovada.
   */
  function drawMany(pool, count, rng = Math.random) {
    const out = [];
    if (!pool.length) return out;
    let bag = [];
    while (out.length < count) {
      if (!bag.length) {
        bag = shuffle(pool, rng);
        if (pool.length > 1 && bag[0] === out[out.length - 1]) bag.push(bag.shift());
      }
      out.push(bag.shift());
    }
    return out;
  }

  /** Um item da lista diferente do atual (para o botão 🎲 de cada post). */
  function drawOther(pool, current, rng = Math.random) {
    if (!pool.length) return '';
    const others = pool.length > 1 ? pool.filter((p) => p !== current) : pool;
    return others[Math.floor(rng() * others.length)];
  }

  /** Hashtags de um post: as fixas + `per` sorteadas da lista (sem repetir dentro do post). */
  function pickHashtags(pool, per, fixed, rng = Math.random) {
    const fix = normalizeHashtags(fixed);
    const fixKeys = new Set(fix.map((t) => t.toLocaleLowerCase('pt-BR')));
    const options = normalizeHashtags(pool).filter((t) => !fixKeys.has(t.toLocaleLowerCase('pt-BR')));
    return fix.concat(shuffle(options, rng).slice(0, Math.max(0, per))).join(' ');
  }

  // ---------- horários em passos de 10 minutos ----------

  const STEP_MIN = 10;
  /** Arredonda para o múltiplo de 10 minutos mais próximo (ou para cima, com up=true). */
  function roundTo10(d, up) {
    const ms = STEP_MIN * 60000;
    const t = up ? Math.ceil(d.getTime() / ms) * ms : Math.round(d.getTime() / ms) * ms;
    const out = new Date(t); out.setSeconds(0, 0); return out;
  }
  /** Primeiro horário sugerido: daqui a pelo menos 30 minutos, num múltiplo de 10. */
  function nextSlot(now = new Date()) { return roundTo10(new Date(now.getTime() + 30 * 60000), true); }
  /** `count` horários a partir de `first`, separados por `minutes` (múltiplos de 10). */
  function distributeInterval(count, first, minutes) {
    const start = roundTo10(first);
    const step = Math.max(STEP_MIN, Math.round(minutes / STEP_MIN) * STEP_MIN) * 60000;
    return Array.from({ length: Math.max(0, count) }, (_, i) => new Date(start.getTime() + i * step));
  }

  // ---------- planilha (CSV) ----------

  const CSV_COLUMNS = ['arquivo', 'tipo', 'titulo', 'legenda', 'hashtags', 'data', 'hora'];

  /** Lê CSV com ";" ou "," (detecta), aspas e quebras de linha dentro de células. */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (!nonEmpty.length) return [];
    const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const header = nonEmpty[0].map(norm);
    return nonEmpty.slice(1).map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
  }

  /** "25/12/2026" ou "2026-12-25" + "19:30" → Date local. */
  function parseDateTime(date, time) {
    let y, mo, d;
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date || '').trim());
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date || '').trim()))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    const t = parseTimes(time || '00:00')[0] || [0, 0];
    const out = new Date(y, mo - 1, d, t[0], t[1]);
    return out.getMonth() === mo - 1 ? out : null;
  }

  /** Converte a planilha em mudanças por arquivo: Map(nomeEmMinúsculas → { kind, title, caption, hashtags, when }). */
  function csvToChanges(text) {
    const map = new Map();
    for (const r of parseCSV(text)) {
      if (!r.arquivo) continue;
      const ch = {};
      if (r.tipo) ch.kind = /reel/i.test(r.tipo) ? 'reel' : 'video';
      if ('titulo' in r && r.titulo) ch.title = r.titulo;
      if ('legenda' in r && r.legenda) ch.caption = r.legenda;
      if ('hashtags' in r && r.hashtags) ch.hashtags = normalizeHashtags(r.hashtags).join(' ');
      if (r.data) { const w = parseDateTime(r.data, r.hora); if (w) ch.when = w; }
      map.set(r.arquivo.split('/').pop().toLowerCase(), ch);
    }
    return map;
  }

  function toCSV(rows) {
    const esc = (v) => { v = String(v ?? ''); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [CSV_COLUMNS.join(';')];
    for (const r of rows) {
      const w = r.when instanceof Date && !isNaN(r.when) ? r.when : null;
      lines.push([r.name, r.kind === 'reel' ? 'Reel' : 'Vídeo', r.title, r.caption, normalizeHashtags(r.hashtags).join(' '),
        w ? fmtDate(w) : '', w ? fmtTime(w) : ''].map(esc).join(';'));
    }
    return '﻿' + lines.join('\r\n') + '\r\n'; // BOM: o Excel abre os acentos certo
  }

  const api = {
    MIN_LEAD_MIN, VIDEO_MAX_MONTHS, REEL_MAX_DAYS, REEL_MAX_SECONDS, HASHTAG_SOFT_LIMIT, CSV_COLUMNS,
    normalizeHashtags, buildDescription, applyTemplate, parseTimes, distribute, maxDate, autoKind, validate,
    parseCSV, parseDateTime, csvToChanges, toCSV, fmtDate, fmtTime, toLocalInput, fromLocalInput,
    parseCaptionPool, shuffle, drawMany, drawOther, pickHashtags, roundTo10, nextSlot, distributeInterval, STEP_MIN,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Agenda = api;
})(typeof window !== 'undefined' ? window : globalThis);
