// Testes do gerador de .zip (Limpar-Metadados/zip.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MiniZip = createRequire(import.meta.url)('../Limpar-Metadados/zip.js');
const fixture = (name) => fs.openAsBlob(path.join(here, 'fixtures', name));

/** Lê um .zip sem compressão (com ou sem ZIP64) e devolve [{ name, data, crc, date, time }]. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'fim do diretório central não encontrado');
  let count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) {
    const loc = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const rec = Number(buf.readBigUInt64LE(loc + 8));
    assert.equal(buf.readUInt32LE(rec), 0x06064b50);
    count = Number(buf.readBigUInt64LE(rec + 32));
    cdOffset = Number(buf.readBigUInt64LE(rec + 48));
  }
  const out = []; let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    let size = buf.readUInt32LE(p + 24), local = buf.readUInt32LE(p + 42);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nLen).toString('utf8');
    if (size === 0xffffffff) { // ZIP64: tamanho original, comprimido e offset no campo extra
      const x = p + 46 + nLen;
      assert.equal(buf.readUInt16LE(x), 0x0001);
      size = Number(buf.readBigUInt64LE(x + 4));
      local = Number(buf.readBigUInt64LE(x + 20));
    }
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, flags, crc, date, time, data: buf.subarray(start, start + size) });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

test('o CRC-32 bate com o do zlib', async () => {
  const blob = await fixture('gps-apple.mov');
  assert.equal(await MiniZip.crc32(blob), zlib.crc32(Buffer.from(await blob.arrayBuffer())));
});

for (const forceZip64 of [false, true]) {
  test(`gera um .zip válido${forceZip64 ? ' no modo ZIP64' : ''}, com nomes em UTF-8 e data fixa`, async () => {
    const files = [
      { name: 'IMG_0001-limpo.mov', blob: await fixture('gps-apple.mov') },
      { name: 'Viagem/praia ação-limpo.mkv', blob: await fixture('gps-tags.mkv') },
      { name: 'vazio.txt', blob: new Blob([]) },
    ];
    let progress = 0;
    const zip = await MiniZip.createZip(files, (done, total) => { progress = done / total; }, { forceZip64 });
    assert.equal(progress, 1);
    const entries = readZip(Buffer.from(await zip.arrayBuffer()));
    assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.name));
    for (let i = 0; i < files.length; i++) {
      const original = Buffer.from(await files[i].blob.arrayBuffer());
      assert.ok(entries[i].data.equals(original), `${files[i].name}: conteúdo diferente`);
      assert.equal(entries[i].crc, zlib.crc32(original));
      assert.equal(entries[i].flags & 0x0800, 0x0800, 'nome deve estar marcado como UTF-8');
      assert.equal(entries[i].date, 0x21, 'data deve ser 1980-01-01 (não revela quando o .zip foi feito)');
      assert.equal(entries[i].time, 0);
    }
  });
}
