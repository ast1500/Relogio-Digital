// Testes do motor real do Facebook (Limpar-Metadados/facebook.js) com um servidor falso:
// confere a sequência de chamadas à Graph API sem precisar de conta nem de internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const FB = createRequire(import.meta.url)('../Limpar-Metadados/facebook.js');

/** Instala um XMLHttpRequest falso. `respond(call)` devolve { status, body }. */
function fakeXhr(respond) {
  const calls = [];
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      const fields = {};
      if (body instanceof FormData) for (const [k, v] of body.entries()) fields[k] = v instanceof Blob ? { blobSize: v.size } : v;
      const call = { url: this.url, headers: this.headers, fields, rawSize: body instanceof Blob ? body.size : null };
      calls.push(call);
      const size = call.fields.video_file_chunk ? call.fields.video_file_chunk.blobSize : (call.rawSize || 0);
      setTimeout(() => {
        if (this.upload.onprogress && size) this.upload.onprogress({ lengthComputable: true, loaded: size, total: size });
        const { status = 200, body: res } = respond(call);
        this.status = status; this.responseText = JSON.stringify(res); this.onload();
      }, 0);
    }
    abort() { this.onabort && this.onabort(); }
  };
  return calls;
}

const page = { id: '123', name: 'Página', token: 'PAGE_TOKEN' };
const when = new Date('2030-05-01T15:30:00Z');

test('vídeo: start → transfer em partes → finish agendado', async () => {
  const blob = new Blob([new Uint8Array(250)]);
  const calls = fakeXhr((c) => {
    const f = c.fields;
    if (f.upload_phase === 'start') return { body: { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '100' } };
    if (f.upload_phase === 'transfer') {
      const next = +f.start_offset + 100;
      return { body: { start_offset: String(Math.min(next, 250)), end_offset: String(Math.min(next + 100, 250)) } };
    }
    return { body: { success: true } };
  });
  const progress = [];
  const out = await FB.real('APP').upload({ page, blob, kind: 'video', title: 'Título', description: 'Legenda\n\n#tag', when, onProgress: (p) => progress.push(p) });
  assert.deepEqual(out, { id: 'V1', url: 'https://www.facebook.com/V1' });
  assert.ok(calls.every((c) => c.url === 'https://graph-video.facebook.com/' + FB.GRAPH_VERSION + '/123/videos'));
  assert.deepEqual(calls.map((c) => c.fields.upload_phase), ['start', 'transfer', 'transfer', 'transfer', 'finish']);
  assert.equal(calls[0].fields.file_size, '250');
  assert.deepEqual(calls.slice(1, 4).map((c) => [c.fields.start_offset, c.fields.video_file_chunk.blobSize]), [['0', 100], ['100', 100], ['200', 50]]);
  const fin = calls[4].fields;
  assert.equal(fin.published, 'false');
  assert.equal(fin.scheduled_publish_time, String(Math.floor(when.getTime() / 1000)));
  assert.equal(fin.description, 'Legenda\n\n#tag');
  assert.equal(fin.title, 'Título');
  assert.equal(fin.access_token, 'PAGE_TOKEN');
  assert.equal(progress[progress.length - 1], 1);
});

test('Reel: start → envio para o upload_url → finish com video_state=SCHEDULED', async () => {
  const blob = new Blob([new Uint8Array(80)]);
  const calls = fakeXhr((c) => {
    if (c.fields.upload_phase === 'start') return { body: { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/R1' } };
    if (c.url.startsWith('https://rupload')) return { body: { success: true } };
    return { body: { success: true } };
  });
  const out = await FB.real('APP').upload({ page, blob, kind: 'reel', title: '', description: 'Oi', when });
  assert.deepEqual(out, { id: 'R1', url: 'https://www.facebook.com/reel/R1' });
  assert.equal(calls[0].url, 'https://graph.facebook.com/' + FB.GRAPH_VERSION + '/123/video_reels');
  assert.equal(calls[1].url, 'https://rupload.facebook.com/video-upload/R1');
  assert.deepEqual(calls[1].headers, { Authorization: 'OAuth PAGE_TOKEN', offset: '0', file_size: '80' });
  assert.equal(calls[1].rawSize, 80);
  assert.equal(calls[2].fields.upload_phase, 'finish');
  assert.equal(calls[2].fields.video_state, 'SCHEDULED');
  assert.equal(calls[2].fields.video_id, 'R1');
  assert.equal(calls[2].fields.title, undefined, 'título vazio não deve ser enviado');
});

test('erros da Graph API viram mensagens claras em português', async () => {
  fakeXhr(() => ({ status: 400, body: { error: { code: 190, message: 'Error validating access token' } } }));
  await assert.rejects(FB.real('APP').upload({ page, blob: new Blob([new Uint8Array(10)]), kind: 'video', description: '', when }),
    (e) => e.code === 190 && /sessão no Facebook expirou/.test(e.message));
  assert.match(FB.friendly({ error: { code: 200, message: 'x' } }).message, /permissão/);
  assert.match(FB.friendly({ error: { code: 100, message: 'The scheduled publish time is invalid' } }).message, /Horário recusado/);
  assert.match(FB.friendly({ error: { code: 4, message: 'x' } }).message, /Espere alguns minutos/);
});

test('modo simulação recusa horário fora da janela, como o Facebook', async () => {
  const m = FB.mock();
  const blob = new Blob([new Uint8Array(10)]);
  await assert.rejects(m.upload({ page, blob, kind: 'video', description: '', when: new Date(Date.now() + 60000) }), /Horário recusado/);
  const ok = await m.upload({ page, blob, kind: 'reel', description: 'oi', when: new Date(Date.now() + 3600000) });
  assert.match(ok.id, /^sim-/);
  assert.equal(m.scheduled.length, 1);
});
