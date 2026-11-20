// Testes do limpador de metadados (Editor-de-Video/metadata.js).
// Rode com: npm test   (ou: node --test tests/)
// Os vídeos em tests/fixtures/ têm metadados falsos, gerados com ffmpeg só para teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VideoMeta = createRequire(import.meta.url)('../Editor-de-Video/metadata.js');
const fixture = (name) => fs.openAsBlob(path.join(here, 'fixtures', name));
const bytes = async (blob) => Buffer.from(await blob.arrayBuffer());
const labels = (r) => r.findings.map((f) => f.label);

test('detecta GPS, aparelho e data em MOV estilo Apple (chaves mdta)', async () => {
  const r = await VideoMeta.analyze(await fixture('gps-apple.mov'));
  assert.equal(r.format, 'mp4');
  assert.equal(r.cleanable, true);
  const gps = r.findings.find((f) => f.label === 'Localização GPS');
  assert.ok(gps, 'deveria achar a localização');
  assert.equal(gps.value, '+40.6892-074.0445/');
  assert.equal(gps.severity, 'alta');
  assert.ok(labels(r).includes('Modelo do aparelho'));
  assert.ok(labels(r).includes('Fabricante'));
  assert.ok(r.findings.some((f) => f.category === 'Data'));
});

test('decodifica a localização 3GPP (loci) em coordenadas', async () => {
  const r = await VideoMeta.analyze(await fixture('udta-3gpp.mp4'));
  const loci = r.findings.find((f) => f.key === 'loci');
  assert.ok(loci);
  assert.match(loci.value, /^48\.858\d, 2\.294\d/);
});

for (const name of ['gps-apple.mov', 'udta-3gpp.mp4']) {
  test(`limpa ${name} sem mudar o tamanho e sem deixar rastros nos bytes`, async () => {
    const original = await fixture(name);
    const { blob, removedBlocks } = await VideoMeta.clean(original);
    assert.ok(removedBlocks > 0);
    assert.equal(blob.size, original.size, 'o tamanho deve ser idêntico (offsets do mdat preservados)');

    const after = await VideoMeta.analyze(blob);
    assert.deepEqual(after.findings, [], 'não deve sobrar nenhum metadado');

    const out = await bytes(blob);
    for (const secret of ['40.6892', '48.8584', 'iPhone', 'Fulano', 'Lavf']) {
      assert.equal(out.includes(secret), false, `"${secret}" não pode continuar no arquivo`);
    }
  });
}

test('o conteúdo do mdat (vídeo e áudio) fica byte a byte igual', async () => {
  const original = await fixture('gps-apple.mov');
  const { blob } = await VideoMeta.clean(original);
  const a = await bytes(original), b = await bytes(blob);
  const mdatAt = (buf) => buf.indexOf('mdat') - 4;
  const ia = mdatAt(a), size = a.readUInt32BE(ia);
  assert.equal(mdatAt(b), ia);
  assert.ok(a.subarray(ia, ia + size).equals(b.subarray(ia, ia + size)));
});

test('lê título, data e app de gravação de WebM', async () => {
  const r = await VideoMeta.analyze(await fixture('titulo.webm'));
  assert.equal(r.format, 'webm');
  assert.equal(r.cleanable, false);
  assert.equal(r.findings.find((f) => f.label === 'Título').value, 'Meu titulo');
  assert.match(r.findings.find((f) => f.label === 'Data de criação').value, /^2024-01-02 03:04:05/);
});

test('recusa limpeza rápida de formatos que não são MP4/MOV', async () => {
  await assert.rejects(VideoMeta.clean(await fixture('titulo.webm')), /MP4\/MOV/);
  const lixo = new Blob([new Uint8Array(64)]);
  assert.equal((await VideoMeta.analyze(lixo)).format, 'unknown');
});
