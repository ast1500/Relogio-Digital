/*
 * zip.js — gera arquivos .zip no navegador, sem bibliotecas.
 *
 * - Sem compressão (método "store"): vídeo já é comprimido, então comprimir de novo só gastaria tempo.
 * - O .zip é montado como um Blob feito de pedaços: os vídeos não são copiados na memória.
 * - ZIP64 automático quando o total passa de 4 GB.
 * - Nomes em UTF-8 e data fixa (1980-01-01) em todos os arquivos, para o .zip não revelar quando foi feito.
 *
 * Funciona no navegador (window.MiniZip) e no Node 22+ (module.exports) para testes.
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** CRC-32 de um Blob, lido em pedaços (não carrega o arquivo inteiro). */
  async function crc32(blob, onProgress) {
    const CHUNK = 4 * 1024 * 1024;
    let crc = 0xffffffff;
    for (let o = 0; o < blob.size; o += CHUNK) {
      const b = new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer());
      for (let i = 0; i < b.length; i++) crc = CRC_TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
      if (onProgress) onProgress(Math.min(blob.size, o + CHUNK));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const MAX32 = 0xffffffff;
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00
  const utf8 = new TextEncoder();

  function header(size, fill) { const b = new Uint8Array(size); fill(new DataView(b.buffer)); return b; }

  /**
   * Monta o .zip.
   * @param {{name: string, blob: Blob}[]} files
   * @param {(feitos: number, total: number) => void} [onProgress] progresso em bytes (cálculo do CRC)
   * @param {{forceZip64?: boolean}} [opts] forceZip64 serve para testar o modo ZIP64 com arquivos pequenos
   * @returns {Promise<Blob>}
   */
  async function createZip(files, onProgress, opts = {}) {
    const total = files.reduce((s, f) => s + f.blob.size, 0);
    let done = 0;
    const parts = [], central = [];
    let offset = 0;

    for (const f of files) {
      const name = utf8.encode(f.name);
      const size = f.blob.size;
      const crc = await crc32(f.blob, (n) => onProgress && onProgress(done + n, total));
      done += size;
      const big = !!opts.forceZip64 || size >= MAX32 || offset >= MAX32;

      // Cabeçalho local
      const localExtra = big ? 20 : 0;
      parts.push(header(30 + name.length + localExtra, (v) => {
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, big ? 45 : 20, true);   // versão necessária
        v.setUint16(6, 0x0800, true);          // nomes em UTF-8
        v.setUint16(8, 0, true);               // sem compressão
        v.setUint16(10, DOS_TIME, true); v.setUint16(12, DOS_DATE, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, big ? MAX32 : size, true);
        v.setUint32(22, big ? MAX32 : size, true);
        v.setUint16(26, name.length, true);
        v.setUint16(28, localExtra, true);
        new Uint8Array(v.buffer).set(name, 30);
        if (big) {
          const e = 30 + name.length;
          v.setUint16(e, 0x0001, true); v.setUint16(e + 2, 16, true);
          v.setBigUint64(e + 4, BigInt(size), true); v.setBigUint64(e + 12, BigInt(size), true);
        }
      }), f.blob);

      // Entrada do diretório central (escrita no fim)
      const cExtra = big ? 28 : 0;
      central.push(header(46 + name.length + cExtra, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 45, true); v.setUint16(6, big ? 45 : 20, true);
        v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true);
        v.setUint16(12, DOS_TIME, true); v.setUint16(14, DOS_DATE, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, big ? MAX32 : size, true);
        v.setUint32(24, big ? MAX32 : size, true);
        v.setUint16(28, name.length, true);
        v.setUint16(30, cExtra, true);
        v.setUint32(42, big ? MAX32 : offset, true);
        new Uint8Array(v.buffer).set(name, 46);
        if (big) {
          const e = 46 + name.length;
          v.setUint16(e, 0x0001, true); v.setUint16(e + 2, 24, true);
          v.setBigUint64(e + 4, BigInt(size), true); v.setBigUint64(e + 12, BigInt(size), true);
          v.setBigUint64(e + 20, BigInt(offset), true);
        }
      }));
      offset += 30 + name.length + localExtra + size;
    }

    const cdStart = offset;
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    parts.push(...central);
    const zip64 = !!opts.forceZip64 || cdStart >= MAX32 || cdSize >= MAX32 || files.length >= 0xffff;
    if (zip64) {
      const recStart = cdStart + cdSize;
      parts.push(header(56, (v) => {               // registro final ZIP64
        v.setUint32(0, 0x06064b50, true); v.setBigUint64(4, 44n, true);
        v.setUint16(12, 45, true); v.setUint16(14, 45, true);
        v.setBigUint64(24, BigInt(files.length), true); v.setBigUint64(32, BigInt(files.length), true);
        v.setBigUint64(40, BigInt(cdSize), true); v.setBigUint64(48, BigInt(cdStart), true);
      }), header(20, (v) => {                       // localizador ZIP64
        v.setUint32(0, 0x07064b50, true); v.setBigUint64(8, BigInt(recStart), true); v.setUint32(16, 1, true);
      }));
    }
    parts.push(header(22, (v) => {                  // fim do diretório central
      v.setUint32(0, 0x06054b50, true);
      const n = Math.min(files.length, 0xffff);
      v.setUint16(8, n, true); v.setUint16(10, n, true);
      v.setUint32(12, zip64 ? MAX32 : cdSize, true);
      v.setUint32(16, zip64 ? MAX32 : cdStart, true);
    }));
    return new Blob(parts, { type: 'application/zip' });
  }

  const api = { createZip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MiniZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
