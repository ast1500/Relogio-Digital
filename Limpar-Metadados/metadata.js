/*
 * metadata.js — inspeção e limpeza de metadados de vídeo, 100% no navegador.
 *
 * MP4 / MOV / M4V / 3GP (ISO-BMFF / QuickTime):
 *   - analyze(): lista GPS, fabricante/modelo, software, datas, XMP, trilhas de telemetria.
 *   - clean():   remove os metadados SEM re-codificar. Os blocos (udta, meta, XMP) são
 *                renomeados para 'free' e têm o conteúdo zerado, e as datas de mvhd/tkhd/mdhd
 *                são zeradas. Como o tamanho dos blocos não muda, os offsets do mdat
 *                continuam válidos e o vídeo/áudio fica byte a byte idêntico.
 *                O mdat (o vídeo em si) nunca é carregado na memória: o arquivo final é
 *                montado com Blob.slice(), então funciona mesmo com arquivos de vários GB.
 *
 * WebM / MKV (EBML):
 *   - analyze(): título, apps de gravação, data, nomes de trilha, Tags (com nome e valor) e anexos.
 *   - clean():   também sem re-codificar: Tags e anexos viram blocos Void, textos são zerados e a data é
 *                apagada, sempre mantendo os tamanhos. Os Clusters (vídeo/áudio) são copiados sem tocar.
 *
 * Funciona no navegador (window.VideoMeta) e no Node 22+ (module.exports) para testes.
 */
(function (root) {
  'use strict';

  const MAC_EPOCH_OFFSET = 2082844800; // segundos entre 1904-01-01 e 1970-01-01
  const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
  const MAX_ZERO_FILL = 64 * 1024 * 1024; // blocos 'free' maiores que isso são mantidos

  // Blocos que só agrupam outros blocos (descemos neles).
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);

  // Rótulos legíveis para as chaves mais comuns.
  const KEY_LABELS = {
    '©xyz': 'Localização GPS', 'com.apple.quicktime.location.ISO6709': 'Localização GPS',
    'com.apple.quicktime.location.accuracy.horizontal': 'Precisão do GPS',
    'com.apple.quicktime.location.name': 'Nome do local',
    '©mak': 'Fabricante', 'com.apple.quicktime.make': 'Fabricante',
    '©mod': 'Modelo do aparelho', 'com.apple.quicktime.model': 'Modelo do aparelho',
    '©swr': 'Software', 'com.apple.quicktime.software': 'Software', '©too': 'Ferramenta de codificação',
    '©day': 'Data de criação', 'com.apple.quicktime.creationdate': 'Data de criação',
    '©nam': 'Título', 'com.apple.quicktime.title': 'Título',
    '©ART': 'Artista', 'com.apple.quicktime.author': 'Autor', '©aut': 'Autor',
    '©cmt': 'Comentário', 'com.apple.quicktime.comment': 'Comentário',
    '©des': 'Descrição', 'com.apple.quicktime.description': 'Descrição',
    'cprt': 'Direitos autorais', '©cpy': 'Direitos autorais',
    'com.android.version': 'Versão do Android', 'com.android.capture.fps': 'FPS de captura',
    'XMP_': 'Pacote XMP (Adobe)', 'Xtra': 'Propriedades do Windows', 'SDLN': 'Número de série (Samsung)',
    'smrd': 'Dados Samsung', 'GPMF': 'Telemetria GoPro', 'FIRM': 'Firmware', 'CAME': 'Número de série da câmera',
    'LENS': 'Lente', 'MUID': 'ID único da mídia', 'loci': 'Localização (3GPP)',
    // chaves 'mdta' curtas (gravadas por ffmpeg, Android e outros)
    'location': 'Localização GPS', 'make': 'Fabricante', 'model': 'Modelo do aparelho', 'title': 'Título',
    'encoder': 'Ferramenta de codificação', 'creation_time': 'Data de criação', 'artist': 'Artista',
    'author': 'Autor', 'comment': 'Comentário', 'description': 'Descrição', 'date': 'Data', 'copyright': 'Direitos autorais',
  };

  function classify(key, label) {
    const k = (key + ' ' + label).toLowerCase();
    if (/xyz|iso6709|location|locali|loci|gps|gpmf|gpmd/.test(k)) return { category: 'Localização', severity: 'alta' };
    if (/serial|série|came|muid|sdln|único/.test(k)) return { category: 'Identificação', severity: 'alta' };
    if (/mak|mod|fabricante|modelo|android|firm|lens|lente|smrd|samsung/.test(k)) return { category: 'Aparelho', severity: 'média' };
    if (/day|date|data/.test(k)) return { category: 'Data', severity: 'média' };
    if (/aut|art|cpy|cprt|nam|title|título|cmt|comment|des|autor|artista|direitos/.test(k)) return { category: 'Autoria', severity: 'média' };
    if (/swr|too|software|ferramenta|xtra|windows/.test(k)) return { category: 'Software', severity: 'baixa' };
    if (/xmp/.test(k)) return { category: 'XMP', severity: 'média' };
    return { category: 'Outros', severity: 'baixa' };
  }

  // ---------- leitura binária ----------

  const u8 = (buf) => new Uint8Array(buf);
  function fourcc(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]).replace(/©/g, '©'); }
  function isPrintableType(b, o) {
    for (let i = 0; i < 4; i++) { const c = b[o + i]; if (!(c === 0xa9 || (c >= 0x20 && c < 0x7f))) return false; }
    return true;
  }
  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
  const utf8 = new TextDecoder('utf-8', { fatal: false });
  function str(b, start, end) { return utf8.decode(b.subarray(start, end)).replace(/\0+$/, '').trim(); }
  function hex(b, start, end) { return Array.from(b.subarray(start, end), (x) => x.toString(16).padStart(2, '0')).join(''); }
  function macDate(secs) {
    if (!secs) return null;
    const d = new Date((secs - MAC_EPOCH_OFFSET) * 1000);
    return isNaN(d) ? null : d;
  }
  function fmtDate(d) { return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'); }

  async function readRange(blob, start, end) { return u8(await blob.slice(start, end).arrayBuffer()); }

  /** Lê um cabeçalho de bloco em b[o..end). Retorna null se inválido. */
  function boxAt(b, o, end, lenient) {
    if (o + 8 > end) return null;
    let size = u32(b, o); const type = fourcc(b, o + 4); let header = 8;
    if (size === 1) { if (o + 16 > end) return null; size = u64(b, o + 8); header = 16; }
    else if (size === 0) size = end - o;
    if (size < header || o + size > end || (!lenient && !isPrintableType(b, o + 4))) return null;
    return { type, start: o, size, header, end: o + size, payload: o + header };
  }
  function children(b, start, end, lenient) {
    const out = []; let o = start;
    while (o < end) { const bx = boxAt(b, o, end, lenient); if (!bx) break; out.push(bx); o = bx.end; }
    return out;
  }

  // ---------- detecção de formato ----------

  async function sniff(blob) {
    const h = await readRange(blob, 0, Math.min(blob.size, 64));
    if (h.length >= 4 && u32(h, 0) === 0x1a45dfa3) return 'webm';
    if (h.length >= 8) {
      const t = fourcc(h, 4);
      if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(t)) return 'mp4';
    }
    return 'unknown';
  }

  /** Lista os blocos de nível superior lendo só os cabeçalhos (não carrega o mdat). */
  async function scanTopLevel(blob) {
    const boxes = []; let o = 0;
    while (o + 8 <= blob.size) {
      const h = await readRange(blob, o, Math.min(blob.size, o + 32));
      let size = u32(h, 0); const type = fourcc(h, 4); let header = 8;
      if (size === 1) { size = u64(h, 8); header = 16; } else if (size === 0) size = blob.size - o;
      if (size < header || o + size > blob.size || !isPrintableType(h, 4)) {
        boxes.push({ type: '(dados finais inválidos)', start: o, size: blob.size - o, header: 0, broken: true });
        break;
      }
      boxes.push({ type, start: o, size, header, uuid: type === 'uuid' ? hex(h, header, header + 16) : null });
      o += size;
    }
    return boxes;
  }

  // ---------- análise MP4 ----------

  /**
   * Percorre um bloco carregado na memória (b = bytes do bloco de topo, base = offset no arquivo)
   * chamando visit(evento) para cada coisa interessante. Usado tanto pela análise quanto pela limpeza.
   */
  function walkMp4(b, visit) {
    function walk(start, end, path) {
      for (const bx of children(b, start, end)) {
        const p = path.concat(bx.type);
        if (CONTAINERS.has(bx.type)) { walk(bx.payload, bx.end, p); if (bx.type === 'trak') visit({ kind: 'trakEnd', box: bx }); continue; }
        switch (bx.type) {
          case 'mvhd': case 'tkhd': case 'mdhd': visit({ kind: 'times', box: bx, path: p }); break;
          case 'udta': visit({ kind: 'udta', box: bx, path: p }); break;
          case 'meta': visit({ kind: 'meta', box: bx, path: p }); break;
          case 'hdlr': visit({ kind: 'hdlr', box: bx, path: p }); break;
          case 'stsd': visit({ kind: 'stsd', box: bx, path: p }); break;
          case 'uuid': visit({ kind: 'uuid', box: bx, path: p }); break;
          case 'free': case 'skip': visit({ kind: 'free', box: bx, path: p }); break;
        }
      }
    }
    walk(0, b.length, []);
  }

  function metaChildrenStart(b, bx) {
    // QuickTime: filhos começam logo após o cabeçalho; ISO: há 4 bytes de versão/flags antes.
    return (bx.payload + 8 <= bx.end && fourcc(b, bx.payload + 4) === 'hdlr') ? bx.payload : bx.payload + 4;
  }

  function decodeDataBox(b, data) {
    // 'data': [tipo 4][locale 4][valor]
    const t = u32(b, data.payload) & 0xffffff; const vs = data.payload + 8; const ve = data.end;
    if (t === 1 || t === 2 || t === 0) return str(b, vs, ve);
    if (t === 21 || t === 22) { const n = ve - vs; return n === 1 ? b[vs] : n === 2 ? u16(b, vs) : n === 4 ? u32(b, vs) : hex(b, vs, ve); }
    if (t === 23 && ve - vs === 4) return new DataView(b.buffer, b.byteOffset + vs, 4).getFloat32(0).toFixed(3);
    if (t === 13 || t === 14 || t === 27) return '[imagem embutida, ' + (ve - vs) + ' bytes]';
    return '[binário, ' + (ve - vs) + ' bytes]';
  }

  function readMeta(b, bx, add, where) {
    const cs = metaChildrenStart(b, bx);
    const kids = children(b, cs, bx.end);
    let keys = null;
    const keysBox = kids.find((k) => k.type === 'keys');
    if (keysBox) {
      keys = []; const n = u32(b, keysBox.payload + 4); let o = keysBox.payload + 8;
      for (let i = 0; i < n && o + 8 <= keysBox.end; i++) { const sz = u32(b, o); if (sz < 8) break; keys.push(str(b, o + 8, o + sz)); o += sz; }
    }
    const ilst = kids.find((k) => k.type === 'ilst');
    if (ilst) {
      for (const item of children(b, ilst.payload, ilst.end, true)) { // itens 'mdta' usam índices binários como tipo
        let key = item.type;
        if (keys) { const idx = u32(b, item.start + 4); if (idx >= 1 && idx <= keys.length) key = keys[idx - 1]; }
        const data = children(b, item.payload, item.end).find((d) => d.type === 'data');
        add(key, data ? decodeDataBox(b, data) : '[' + (item.size) + ' bytes]', where);
      }
    }
    for (const k of kids) if (k.type === 'XMP_' || k.type === 'xml ') add('XMP_', '[' + k.size + ' bytes de XML]', where);
    if (!ilst && !kids.some((k) => k.type === 'XMP_')) add('meta', '[bloco meta, ' + bx.size + ' bytes]', where);
  }

  function readUdta(b, bx, add, where) {
    for (const k of children(b, bx.payload, bx.end)) {
      if (k.type === 'meta') { readMeta(b, k, add, where); continue; }
      if (k.type.startsWith('©')) {
        // Texto QuickTime: [tamanho 2][idioma 2][texto]
        const len = u16(b, k.payload);
        if (len > 0 && k.payload + 4 + len <= k.end) { add(k.type, str(b, k.payload + 4, k.payload + 4 + len), where); continue; }
        const data = children(b, k.payload, k.end).find((d) => d.type === 'data');
        add(k.type, data ? decodeDataBox(b, data) : str(b, k.payload, k.end), where);
        continue;
      }
      if (k.type === 'free' || k.type === 'skip') continue;
      if (k.type === 'loci' && k.end - k.payload >= 20) {
        // 3GPP: [versão 4][idioma 2][nome\0][papel 1][longitude 16.16][latitude 16.16][altitude 16.16]
        let o = k.payload + 6; const ns = o; while (o < k.end && b[o] !== 0) o++;
        const name = str(b, ns, o); o += 2;
        if (o + 8 <= k.end) {
          const dv = new DataView(b.buffer, b.byteOffset + o, 8);
          const lon = dv.getInt32(0) / 65536, lat = dv.getInt32(4) / 65536;
          add('loci', lat.toFixed(4) + ', ' + lon.toFixed(4) + (name ? ' (' + name + ')' : ''), where);
          continue;
        }
      }
      add(k.type, '[bloco proprietário, ' + k.size + ' bytes]', where);
    }
  }

  async function analyzeMp4(blob) {
    const top = await scanTopLevel(blob);
    const findings = [];
    let trackNo = 0; let curTrack = null;
    const add = (key, value, where) => {
      const label = KEY_LABELS[key] || key;
      const c = classify(key, label);
      findings.push({ key, label, value: String(value), where, category: c.category, severity: c.severity, removable: true });
    };

    for (const t of top) {
      if (t.broken) { findings.push({ key: 'tail', label: 'Dados extras no fim do arquivo', value: t.size + ' bytes', where: 'arquivo', category: 'Outros', severity: 'média', removable: false }); continue; }
      if (t.type === 'uuid' && t.uuid === XMP_UUID) { add('XMP_', '[' + t.size + ' bytes de XML]', 'arquivo'); continue; }
      if (t.type === 'meta') { const b = await readRange(blob, t.start, t.start + t.size); readMeta(b, boxAt(b, 0, b.length), add, 'arquivo'); continue; }
      if (t.type !== 'moov') continue;
      const b = await readRange(blob, t.start, t.start + t.size);
      walkMp4(b, (ev) => {
        const bx = ev.box;
        if (ev.kind === 'times') {
          if (bx.type === 'tkhd') { trackNo++; curTrack = { no: trackNo }; }
          const v = b[bx.payload];
          const c = v === 1 ? u64(b, bx.payload + 4) : u32(b, bx.payload + 4);
          const m = v === 1 ? u64(b, bx.payload + 12) : u32(b, bx.payload + 8);
          const where = bx.type === 'mvhd' ? 'filme' : 'trilha ' + trackNo;
          const dc = macDate(c), dm = macDate(m);
          if (dc) findings.push({ key: bx.type + '.creation', label: 'Data de criação (' + bx.type + ')', value: fmtDate(dc), where, category: 'Data', severity: 'média', removable: true });
          if (dm && m !== c) findings.push({ key: bx.type + '.modification', label: 'Data de modificação (' + bx.type + ')', value: fmtDate(dm), where, category: 'Data', severity: 'baixa', removable: true });
        } else if (ev.kind === 'udta') {
          readUdta(b, bx, add, ev.path.includes('trak') ? 'trilha ' + trackNo : 'filme');
        } else if (ev.kind === 'meta') {
          readMeta(b, bx, add, ev.path.includes('trak') ? 'trilha ' + trackNo : 'filme');
        } else if (ev.kind === 'hdlr' && ev.path.includes('mdia') && curTrack) {
          curTrack.handler = fourcc(b, bx.payload + 8);
        } else if (ev.kind === 'stsd' && curTrack) {
          if (u32(b, bx.payload + 4) > 0) curTrack.codec = fourcc(b, bx.payload + 12);
        } else if (ev.kind === 'uuid' && hex(b, bx.payload, bx.payload + 16) === XMP_UUID) {
          add('XMP_', '[' + bx.size + ' bytes de XML]', 'filme');
        } else if (ev.kind === 'trakEnd' && curTrack) {
          const h = curTrack.handler, codec = curTrack.codec || '?';
          if (h === 'meta' || ['gpmd', 'mebx', 'camm'].includes(codec)) {
            const gps = codec === 'gpmd' || codec === 'camm';
            findings.push({
              key: 'track.' + codec, label: gps ? 'Trilha de telemetria (GPS/sensores)' : 'Trilha de metadados temporizados',
              value: 'codec "' + codec + '" na trilha ' + curTrack.no, where: 'trilha ' + curTrack.no,
              category: gps ? 'Localização' : 'Outros', severity: gps ? 'alta' : 'média', removable: false,
            });
          }
          curTrack = null;
        }
      });
    }
    return { format: 'mp4', findings, topLevel: top.map((t) => ({ type: t.type, size: t.size })), cleanable: top.some((t) => t.type === 'moov') };
  }

  // ---------- limpeza MP4 ----------

  function zeroBox(b, bx) { b.set([0x66, 0x72, 0x65, 0x65], bx.start + 4); b.fill(0, bx.payload, bx.end); } // 'free' + zeros

  function cleanMoovBytes(b) {
    let removed = 0;
    walkMp4(b, (ev) => {
      const bx = ev.box;
      if (ev.kind === 'times') {
        const v = b[bx.payload];
        b.fill(0, bx.payload + 4, bx.payload + 4 + (v === 1 ? 16 : 8));
      } else if (ev.kind === 'udta' || ev.kind === 'meta') { zeroBox(b, bx); removed++; }
      else if (ev.kind === 'uuid' && hex(b, bx.payload, bx.payload + 16) === XMP_UUID) { zeroBox(b, bx); removed++; }
      else if (ev.kind === 'free') b.fill(0, bx.payload, bx.end);
    });
    return removed;
  }

  function freeHeader(size, header) {
    const h = new Uint8Array(header);
    if (header === 16) { h.set([0, 0, 0, 1], 0); const hi = Math.floor(size / 4294967296), lo = size >>> 0; h.set([hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255], 8); }
    else h.set([size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255], 0);
    h.set([0x66, 0x72, 0x65, 0x65], 4);
    return h;
  }

  async function cleanMp4(blob) {
    const top = await scanTopLevel(blob);
    const parts = []; let removed = 0;
    for (const t of top) {
      if (t.broken) { removed++; continue; } // descarta lixo no fim do arquivo
      const isXmp = t.type === 'uuid' && t.uuid === XMP_UUID;
      if (t.type === 'moov') {
        const b = await readRange(blob, t.start, t.start + t.size);
        removed += cleanMoovBytes(b);
        parts.push(b);
      } else if (t.type === 'meta' || isXmp || ((t.type === 'free' || t.type === 'skip') && t.size - t.header <= MAX_ZERO_FILL)) {
        if (t.type !== 'free' && t.type !== 'skip') removed++;
        parts.push(freeHeader(t.size, t.header), new Uint8Array(t.size - t.header));
      } else {
        parts.push(blob.slice(t.start, t.start + t.size)); // mdat, ftyp etc.: copiados sem tocar
      }
    }
    return { blob: new Blob(parts, { type: blob.type || 'video/mp4' }), removedBlocks: removed };
  }

  // ---------- WebM / MKV (EBML) ----------

  function ebmlVint(b, o, keepMarker) {
    const first = b[o]; if (first === undefined) return null;
    let len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || o + len > b.length) return null;
    let val = keepMarker ? first : first & (mask - 1); let allOnes = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < len; i++) { val = val * 256 + b[o + i]; if (b[o + i] !== 255) allOnes = false; }
    return { val, len, unknown: !keepMarker && allOnes };
  }

  const EB = {
    EBML: 0x1a45dfa3, SEGMENT: 0x18538067, CLUSTER: 0x1f43b675, INFO: 0x1549a966, TAGS: 0x1254c367,
    ATTACH: 0x1941a469, TRACKS: 0x1654ae6b, TRACKENTRY: 0xae, TITLE: 0x7ba9, MUX: 0x4d80, WRITE: 0x5741,
    DATE: 0x4461, TRACKNAME: 0x536e, TAG: 0x7373, SIMPLETAG: 0x67c8, TAGNAME: 0x45a3, TAGSTRING: 0x4487, VOID: 0xec,
  };
  const WEBM_LOADED = new Set([EB.INFO, EB.TRACKS, EB.TAGS]);       // blocos lidos para a memória (pequenos)
  const WEBM_VOIDED = new Set([EB.TAGS, EB.ATTACH]);                // blocos apagados por inteiro

  /** Elementos filhos dentro de b[start..end). */
  function ebmlChildren(b, start, end) {
    const out = []; let o = start;
    while (o < end) {
      const id = ebmlVint(b, o, true); if (!id) break;
      const sz = ebmlVint(b, o + id.len, false); if (!sz) break;
      const ds = o + id.len + sz.len, de = sz.unknown ? end : ds + sz.val;
      if (de > end) break;
      out.push({ id: id.val, start: o, ds, de });
      o = de;
    }
    return out;
  }

  /**
   * Percorre os filhos do Segment lendo só cabeçalhos (os Clusters, que são o vídeo, nunca são carregados).
   * Para num Cluster de tamanho desconhecido (comum em gravações ao vivo): o que vem depois é só vídeo.
   */
  async function scanWebm(blob) {
    const h = await readRange(blob, 0, Math.min(blob.size, 64));
    const eId = ebmlVint(h, 0, true), eSz = eId && ebmlVint(h, eId.len, false);
    if (!eSz || eId.val !== EB.EBML) return null;
    let o = eId.len + eSz.len + eSz.val;
    const sh = await readRange(blob, o, Math.min(blob.size, o + 16));
    const sId = ebmlVint(sh, 0, true), sSz = sId && ebmlVint(sh, sId.len, false);
    if (!sSz || sId.val !== EB.SEGMENT) return null;
    const segEnd = sSz.unknown ? blob.size : Math.min(blob.size, o + sId.len + sSz.len + sSz.val);
    o += sId.len + sSz.len;
    const children = []; let partial = false;
    while (o + 2 <= segEnd) {
      const b = await readRange(blob, o, Math.min(segEnd, o + 16));
      const id = ebmlVint(b, 0, true), sz = id && ebmlVint(b, id.len, false);
      if (!sz) break;
      const ds = o + id.len + sz.len;
      if (sz.unknown) { if (id.val !== EB.CLUSTER) partial = true; break; }
      const de = ds + sz.val;
      if (de > segEnd) break;
      const child = { id: id.val, start: o, ds, de };
      if (WEBM_LOADED.has(id.val)) child.bytes = await readRange(blob, o, de);
      children.push(child);
      o = de;
    }
    return { children, partial };
  }

  function tagLabel(name) { return KEY_LABELS[name.toLowerCase()] || KEY_LABELS[name] || name; }

  async function analyzeWebm(blob) {
    const scan = await scanWebm(blob);
    if (!scan) return { format: 'unknown', findings: [], cleanable: false };
    const findings = [];
    const add = (key, label, value, category, severity) => {
      if (value === '') return; // campo já zerado
      findings.push({ key, label, value: String(value), where: 'arquivo', category, severity, removable: true });
    };
    for (const c of scan.children) {
      const b = c.bytes, rel = (x) => x - c.start;
      if (c.id === EB.INFO) {
        for (const e of ebmlChildren(b, rel(c.ds), b.length)) {
          if (e.id === EB.TITLE) add('title', 'Título', str(b, e.ds, e.de), 'Autoria', 'média');
          else if (e.id === EB.MUX) add('mux', 'Aplicativo de multiplexação', str(b, e.ds, e.de), 'Software', 'baixa');
          else if (e.id === EB.WRITE) add('write', 'Aplicativo de gravação', str(b, e.ds, e.de), 'Software', 'baixa');
          else if (e.id === EB.DATE && e.de - e.ds === 8) {
            const ns = new DataView(b.buffer, b.byteOffset + e.ds, 8).getBigInt64(0); // ns desde 2001-01-01
            add('date', 'Data de criação', fmtDate(new Date(Date.UTC(2001, 0, 1) + Number(ns / 1000000n))), 'Data', 'média');
          }
        }
      } else if (c.id === EB.TRACKS) {
        for (const t of ebmlChildren(b, rel(c.ds), b.length)) {
          if (t.id !== EB.TRACKENTRY) continue;
          for (const e of ebmlChildren(b, t.ds, t.de)) if (e.id === EB.TRACKNAME) add('trackname', 'Nome da trilha', str(b, e.ds, e.de), 'Outros', 'baixa');
        }
      } else if (c.id === EB.TAGS) {
        let n = 0;
        for (const tag of ebmlChildren(b, rel(c.ds), b.length)) {
          if (tag.id !== EB.TAG) continue;
          for (const st of ebmlChildren(b, tag.ds, tag.de)) {
            if (st.id !== EB.SIMPLETAG) continue;
            let name = '', value = '';
            for (const e of ebmlChildren(b, st.ds, st.de)) {
              if (e.id === EB.TAGNAME) name = str(b, e.ds, e.de);
              else if (e.id === EB.TAGSTRING) value = str(b, e.ds, e.de);
            }
            if (!name) continue;
            const label = tagLabel(name), cl = classify(name, label);
            add('tag.' + name, label, value || '[vazio]', cl.category, cl.severity); n++;
          }
        }
        if (!n) add('tags', 'Tags (metadados livres)', (c.de - c.ds) + ' bytes', 'Outros', 'média');
      } else if (c.id === EB.ATTACH) {
        add('attach', 'Anexos embutidos', (c.de - c.ds) + ' bytes', 'Outros', 'média');
      }
    }
    return { format: 'webm', findings, cleanable: true, partial: scan.partial };
  }

  /** Cabeçalho de um elemento Void (ignorado pelos players) que ocupa exatamente `total` bytes. */
  function voidHeader(total) {
    const h = new Uint8Array(Math.min(total, 9));
    h[0] = EB.VOID;
    if (total >= 9) {          // tamanho em 8 bytes: 0x01 + 7 bytes
      h[1] = 0x01; const n = total - 9;
      for (let i = 0; i < 7; i++) h[8 - i] = Math.floor(n / Math.pow(256, i)) & 255;
    } else h[1] = 0x80 | (total - 2);
    return h;
  }
  function writeVoid(b, start, len) { if (len < 2) return; b.fill(0, start, start + len); b.set(voidHeader(len), start); }

  async function cleanWebm(blob) {
    const scan = await scanWebm(blob);
    if (!scan) throw new Error('Arquivo WebM/MKV inválido.');
    const parts = []; let cursor = 0, removed = 0;
    for (const c of scan.children) {
      const total = c.de - c.start;
      if (WEBM_VOIDED.has(c.id)) {
        // Cabeçalho de Void + zeros, sem carregar o conteúdo original (anexos podem ser grandes)
        const head = voidHeader(total);
        parts.push(blob.slice(cursor, c.start), head, new Uint8Array(total - head.length));
        cursor = c.de; removed++;
      } else if (c.id === EB.INFO || c.id === EB.TRACKS) {
        const b = c.bytes, rel = (x) => x - c.start; let touched = false;
        const scrub = (e, voidIt) => { if (voidIt) writeVoid(b, e.start, e.de - e.start); else b.fill(0, e.ds, e.de); touched = true; removed++; };
        if (c.id === EB.INFO) {
          for (const e of ebmlChildren(b, rel(c.ds), b.length)) {
            if (e.id === EB.TITLE || e.id === EB.MUX || e.id === EB.WRITE) scrub(e, false); // texto vira vazio
            else if (e.id === EB.DATE) scrub(e, true);
          }
        } else {
          for (const t of ebmlChildren(b, rel(c.ds), b.length)) {
            if (t.id !== EB.TRACKENTRY) continue;
            for (const e of ebmlChildren(b, t.ds, t.de)) if (e.id === EB.TRACKNAME) scrub(e, false);
          }
        }
        if (touched) { parts.push(blob.slice(cursor, c.start), b); cursor = c.de; }
      }
    }
    parts.push(blob.slice(cursor));
    return { blob: new Blob(parts, { type: blob.type || 'video/webm' }), removedBlocks: removed };
  }

  // ---------- API pública ----------

  async function analyze(blob) {
    const fmt = await sniff(blob);
    if (fmt === 'mp4') return analyzeMp4(blob);
    if (fmt === 'webm') return analyzeWebm(blob);
    return { format: 'unknown', findings: [], cleanable: false };
  }

  /** Remove os metadados sem re-codificar (MP4/MOV/M4V/3GP e WebM/MKV). */
  async function clean(blob) {
    const fmt = await sniff(blob);
    if (fmt === 'mp4') return cleanMp4(blob);
    if (fmt === 'webm') return cleanWebm(blob);
    throw new Error('Formato não suportado para limpeza sem re-codificação. Use a limpeza profunda.');
  }

  const api = { analyze, clean, sniff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VideoMeta = api;
})(typeof window !== 'undefined' ? window : globalThis);
