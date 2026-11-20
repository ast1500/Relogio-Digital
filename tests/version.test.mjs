// Garante que o número da versão é o mesmo em todos os lugares (senão o aviso de atualização e o cache se confundem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('versão igual em package.json, version.json, página e endereços dos arquivos', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('Limpar-Metadados/version.json')).version, v);
  const html = read('Limpar-Metadados/index.html');
  assert.match(html, new RegExp('data-version="' + v.replace(/\./g, '\\.') + '"'));
  assert.match(html, new RegExp('Vídeo Limpo <b>v' + v.replace(/\./g, '\\.') + '</b>'));
  const assets = [...html.matchAll(/(?:src|href)="([\w-]+\.(?:js|css))(\?v=[^"]*)?"/g)];
  assert.ok(assets.length >= 8);
  for (const [, file, q] of assets) assert.equal(q, '?v=' + v, file + ' sem ?v=' + v);
  assert.match(read('CHANGELOG.md'), new RegExp('## \\[' + v.replace(/\./g, '\\.') + '\\]'));
});
