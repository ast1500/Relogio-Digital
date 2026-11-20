// Testes das regras de agendamento (Limpar-Metadados/schedule.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const A = createRequire(import.meta.url)('../Limpar-Metadados/schedule.js');

test('hashtags: adiciona #, tira repetidas e símbolos, mantém acentos', () => {
  assert.deepEqual(A.normalizeHashtags('viagem, #Praia  férias #praia ##sol! , #'), ['#viagem', '#Praia', '#férias', '#sol']);
  assert.deepEqual(A.normalizeHashtags(''), []);
});

test('texto do post: legenda + linha em branco + hashtags', () => {
  assert.equal(A.buildDescription('Olha isso!', 'viagem praia'), 'Olha isso!\n\n#viagem #praia');
  assert.equal(A.buildDescription('  Só legenda ', ''), 'Só legenda');
  assert.equal(A.buildDescription('', '#tag'), '#tag');
});

test('modelo de legenda com {n}, {total}, {nome}, {data} e {hora}', () => {
  const when = new Date(2026, 11, 25, 19, 5);
  assert.equal(A.applyTemplate('Parte {n}/{total} – {nome} – {data} {hora}', { n: 3, total: 10, nome: 'praia.mov', when }),
    'Parte 3/10 – praia – 25/12/2026 19:05');
});

test('horários: aceita 12:00, 19h, 8h30 e ignora inválidos', () => {
  assert.deepEqual(A.parseTimes('19h, 12:00; 8h30 25:00 abc 12:00'), [[8, 30], [12, 0], [19, 0]]);
});

test('distribuir: 2 por dia, só de segunda a sexta', () => {
  const start = new Date(2026, 11, 4); // sexta-feira, 04/12/2026
  const dates = A.distribute(5, { start, times: '12:00, 19:00', weekdays: [1, 2, 3, 4, 5], notBefore: new Date(2026, 0, 1) });
  assert.deepEqual(dates.map((d) => A.fmtDate(d) + ' ' + A.fmtTime(d)), [
    '04/12/2026 12:00', '04/12/2026 19:00', // sexta
    '07/12/2026 12:00', '07/12/2026 19:00', // pula sábado e domingo
    '08/12/2026 12:00',
  ]);
});

test('distribuir: pula horários que já passaram', () => {
  const start = new Date(2026, 11, 4);
  const dates = A.distribute(2, { start, times: '08:00, 12:00, 19:00', notBefore: new Date(2026, 11, 4, 10, 0) });
  assert.deepEqual(dates.map((d) => A.fmtTime(d)), ['12:00', '19:00']);
});

test('tipo automático: vertical e curto vira Reel', () => {
  assert.equal(A.autoKind({ width: 1080, height: 1920, duration: 30 }), 'reel');
  assert.equal(A.autoKind({ width: 1080, height: 1920, duration: 300 }), 'video');
  assert.equal(A.autoKind({ width: 1920, height: 1080, duration: 30 }), 'video');
  assert.equal(A.autoKind(null), 'video');
});

test('validação: janela de 10 minutos a 6 meses (vídeo) e limites de Reel', () => {
  const now = new Date(2026, 0, 10, 12, 0);
  const at = (min) => new Date(now.getTime() + min * 60000);
  const errs = (row) => A.validate(row, now).filter((i) => i.level === 'error').map((i) => i.msg);
  assert.deepEqual(errs({ kind: 'video', when: at(30), caption: 'oi' }), []);
  assert.match(errs({ kind: 'video', when: at(5), caption: 'oi' })[0], /10 minutos/);
  assert.match(errs({ kind: 'video', when: new Date(2026, 7, 1), caption: 'oi' })[0], /6 meses/);
  assert.match(errs({ kind: 'reel', when: at(60 * 24 * 40), caption: 'oi', meta: { width: 9, height: 16, duration: 20 } })[0], /29 dias/);
  assert.match(errs({ kind: 'reel', when: at(60), caption: 'oi', meta: { width: 16, height: 9, duration: 20 } })[0], /verticais/);
  assert.match(errs({ kind: 'reel', when: at(60), caption: 'oi', meta: { width: 9, height: 16, duration: 200 } })[0], /90 segundos/);
  assert.match(errs({ kind: 'video', when: null })[0], /data e a hora/);
});

test('validação: avisos de horário repetido, sem legenda e excesso de hashtags', () => {
  const now = new Date(2026, 0, 10, 12, 0);
  const when = new Date(2026, 0, 11, 12, 0);
  const a = { kind: 'video', when, caption: '', hashtags: '#a #b #c #d #e #f' }, b = { kind: 'video', when, caption: 'x' };
  const warns = A.validate(a, now, [a, b]).filter((i) => i.level === 'warn').map((i) => i.msg).join(' | ');
  assert.match(warns, /mesmo horário/);
  assert.match(warns, /5 hashtags/);
  assert.doesNotMatch(warns, /Sem legenda/); // hashtags contam como texto
});

test('CSV: lê ";" do Excel, aspas, quebra de linha e datas brasileiras', () => {
  const csv = '﻿Arquivo;Tipo;Título;Legenda;Hashtags;Data;Hora\r\n' +
    'IMG_0001.MOV;Reel;Praia;"Linha 1\nLinha 2 com ""aspas""";viagem praia;25/12/2026;19:30\r\n' +
    'pasta/IMG_0002.mp4;vídeo;;;;2026-12-26;8h\r\n';
  const ch = A.csvToChanges(csv);
  const a = ch.get('img_0001.mov');
  assert.equal(a.kind, 'reel');
  assert.equal(a.title, 'Praia');
  assert.equal(a.caption, 'Linha 1\nLinha 2 com "aspas"');
  assert.equal(a.hashtags, '#viagem #praia');
  assert.equal(A.fmtDate(a.when) + ' ' + A.fmtTime(a.when), '25/12/2026 19:30');
  const b = ch.get('img_0002.mp4');
  assert.equal(b.kind, 'video');
  assert.equal(A.fmtTime(b.when), '08:00');
  assert.equal(b.caption, undefined);
});

test('CSV: exportar e importar de volta dá o mesmo resultado', () => {
  const rows = [{ name: 'a.mp4', kind: 'reel', title: 'T; 1', caption: 'Oi "você"\nlinha 2', hashtags: 'x y', when: new Date(2026, 4, 1, 9, 15) }];
  const back = A.csvToChanges(A.toCSV(rows)).get('a.mp4');
  assert.equal(back.title, 'T; 1');
  assert.equal(back.caption, 'Oi "você"\nlinha 2');
  assert.equal(back.hashtags, '#x #y');
  assert.equal(back.when.getTime(), rows[0].when.getTime());
});

test('datas inválidas na planilha são ignoradas', () => {
  assert.equal(A.parseDateTime('31/02/2026', '10:00'), null);
  assert.equal(A.parseDateTime('ontem', '10:00'), null);
});

// gerador "aleatório" previsível para os testes
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('lista de legendas: uma por linha, ou separadas por linha em branco', () => {
  assert.deepEqual(A.parseCaptionPool('Primeira\nSegunda\n\nTerceira'), ['Primeira\nSegunda', 'Terceira']);
  assert.deepEqual(A.parseCaptionPool(' Uma \nDuas\r\nTrês\n'), ['Uma', 'Duas', 'Três']);
  assert.deepEqual(A.parseCaptionPool('   '), []);
});

test('sorteio de legendas usa todas antes de repetir e não repete seguida', () => {
  const pool = ['a', 'b', 'c'];
  const out = A.drawMany(pool, 9, seeded(7));
  for (let i = 0; i < 9; i += 3) assert.deepEqual(out.slice(i, i + 3).sort(), ['a', 'b', 'c']);
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i], out[i - 1]);
  assert.deepEqual(A.drawMany([], 3), []);
  assert.notEqual(A.drawOther(pool, 'a', seeded(3)), 'a');
});

test('hashtags sorteadas: fixas + N da lista, sem repetir', () => {
  const tags = A.pickHashtags('#a #b #c #d #marca', 2, 'marca', seeded(5)).split(' ');
  assert.equal(tags[0], '#marca');
  assert.equal(tags.length, 3);
  assert.equal(new Set(tags.map((t) => t.toLowerCase())).size, 3);
  assert.equal(A.pickHashtags('#a #b', 10, '', seeded(1)).split(' ').length, 2, 'não inventa hashtags além da lista');
});

test('horários em passos de 10 minutos', () => {
  assert.equal(A.fmtTime(A.roundTo10(new Date(2026, 0, 1, 10, 14))), '10:10');
  assert.equal(A.fmtTime(A.roundTo10(new Date(2026, 0, 1, 10, 15))), '10:20');
  assert.equal(A.fmtTime(A.roundTo10(new Date(2026, 0, 1, 10, 11), true)), '10:20');
  assert.equal(A.fmtTime(A.nextSlot(new Date(2026, 0, 1, 10, 1))), '10:40');
  const d = A.distributeInterval(4, new Date(2026, 0, 1, 23, 33), 10);
  assert.deepEqual(d.map((x) => A.fmtTime(x)), ['23:30', '23:40', '23:50', '00:00']);
  assert.equal(A.distributeInterval(2, new Date(2026, 0, 1, 9, 0), 1440)[1].getDate(), 2);
});
