// Testes do limpador de metadados (Limpar-Metadados/metadata.js).
// Rode com: npm test   (ou: node --test tests/)
// Os vídeos em tests/fixtures/ têm metadados falsos, gerados com ffmpeg só para teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VideoMeta = createRequire(import.meta.url)('../Limpar-Metadados/metadata.js');
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

test('lê título, data, apps e tags de WebM', async () => {
  const r = await VideoMeta.analyze(await fixture('titulo.webm'));
  assert.equal(r.format, 'webm');
  assert.equal(r.cleanable, true);
  assert.equal(r.findings.find((f) => f.label === 'Título').value, 'Meu titulo');
  assert.match(r.findings.find((f) => f.label === 'Data de criação').value, /^2024-01-02 03:04:05/);
});

test('acha GPS, autor e nome de trilha nas tags de MKV', async () => {
  const r = await VideoMeta.analyze(await fixture('gps-tags.mkv'));
  const gps = r.findings.find((f) => f.label === 'Localização GPS');
  assert.equal(gps.value, '+40.6892-074.0445/');
  assert.equal(gps.severity, 'alta');
  assert.ok(r.findings.some((f) => f.label === 'Artista' && f.value === 'Fulano'));
  assert.ok(r.findings.some((f) => f.label === 'Nome da trilha' && f.value === 'Camera traseira'));
});

for (const [name, secrets] of [
  ['titulo.webm', ['Meu titulo', 'Lavf']],
  ['gps-tags.mkv', ['40.6892', 'Fulano', 'Ferias', 'Camera traseira', 'Lavf']],
  ['anexo.mkv', ['segredo123', 'MIT License', 'Lavf']],
]) {
  test(`limpa ${name} sem re-codificar e sem deixar rastros`, async () => {
    const original = await fixture(name);
    const { blob, removedBlocks } = await VideoMeta.clean(original);
    assert.ok(removedBlocks > 0);
    assert.equal(blob.size, original.size);
    assert.deepEqual((await VideoMeta.analyze(blob)).findings, []);
    const out = await bytes(blob);
    for (const secret of secrets) assert.equal(out.includes(secret), false, `"${secret}" não pode continuar no arquivo`);
  });
}

test('em MKV, os blocos de vídeo (Clusters) ficam idênticos', async () => {
  const original = await fixture('gps-tags.mkv');
  const a = await bytes(original), b = await bytes((await VideoMeta.clean(original)).blob);
  const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
  const ia = a.indexOf(cluster);
  assert.ok(ia > 0);
  assert.equal(b.indexOf(cluster), ia);
  const end = a.indexOf(Buffer.from([0x1c, 0x53, 0xbb, 0x6b])); // Cues, depois dos Clusters
  assert.ok(a.subarray(ia, end > ia ? end : a.length).equals(b.subarray(ia, end > ia ? end : b.length)));
});

test('recusa limpeza rápida de formatos desconhecidos', async () => {
  const lixo = new Blob([new Uint8Array(64)]);
  assert.equal((await VideoMeta.analyze(lixo)).format, 'unknown');
  await assert.rejects(VideoMeta.clean(lixo), /limpeza profunda/);
});
