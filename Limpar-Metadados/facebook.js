/*
 * facebook.js — conexão com a Página do Facebook para agendar vídeos e Reels.
 *
 * Dois "motores" com a mesma interface:
 *   FacebookPages.real(appId, configId) → Graph API de verdade (login pelo SDK oficial, carregado só quando usado).
 *     configId: ID da configuração do "Login do Facebook para Empresas" (se o app usar esse tipo de login).
 *   FacebookPages.mock()       → Facebook simulado, para testar a tela inteira sem conta
 *
 * Interface:
 *   connect()                         → { name }
 *   pages()                           → [{ id, name, token, picture }]
 *   upload({ page, blob, kind, title, description, when, onProgress, signal }) → { id, url }
 *   disconnect()
 *
 * Os tokens ficam só na memória desta aba. O App Secret nunca é usado no navegador.
 */
(function (root) {
  'use strict';

  const GRAPH_VERSION = 'v26.0';
  const GRAPH = 'https://graph.facebook.com/' + GRAPH_VERSION;
  const GRAPH_VIDEO = 'https://graph-video.facebook.com/' + GRAPH_VERSION;
  const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'publish_video'];
  const PLANNER_URL = 'https://business.facebook.com/latest/content_calendar';

  // ---------- erros com mensagens em português ----------

  class FbError extends Error {
    constructor(message, code, raw) { super(message); this.code = code; this.raw = raw; }
  }
  function friendly(err) {
    const e = (err && err.error) || err || {};
    const code = e.code, sub = e.error_subcode, msg = e.error_user_msg || e.message || 'Erro desconhecido do Facebook.';
    if (code === 190) return new FbError('Sua sessão no Facebook expirou. Entre de novo.', code, e);
    if (code === 10 || code === 200 || (code >= 200 && code < 300)) return new FbError('Falta permissão para publicar nesta Página. Entre de novo e aceite todas as permissões.', code, e);
    if (code === 368) return new FbError('O Facebook bloqueou temporariamente as publicações desta Página.', code, e);
    if (code === 4 || code === 17 || code === 32 || code === 613) return new FbError('Muitas solicitações seguidas. Espere alguns minutos e tente de novo.', code, e);
    if (code === 100 && /schedul/i.test(msg)) return new FbError('Horário recusado pelo Facebook: ' + msg, code, e);
    if (code === 6000 || code === 6001 || sub === 1363019) return new FbError('O Facebook não conseguiu processar este vídeo (formato ou tamanho).', code, e);
    return new FbError(msg, code, e);
  }

  // ---------- HTTP ----------

  /** POST multipart com progresso de envio (XMLHttpRequest, porque fetch não informa progresso). */
  function xhrPost(url, form, { onProgress, signal, headers, body } = {}) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      if (headers) for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
      if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      x.onload = () => {
        let data = null; try { data = JSON.parse(x.responseText); } catch (e) { /* resposta não JSON */ }
        if (x.status >= 200 && x.status < 300 && data && !data.error) resolve(data);
        else reject(friendly(data || { message: 'Falha de rede (HTTP ' + x.status + ').' }));
      };
      x.onerror = () => reject(new FbError('Falha de conexão com o Facebook. Verifique a internet.'));
      x.onabort = () => reject(new FbError('Envio cancelado.', 'abort'));
      if (signal) { if (signal.aborted) { x.abort(); return; } signal.addEventListener('abort', () => x.abort(), { once: true }); }
      x.send(body !== undefined ? body : form);
    });
  }
  function formOf(obj) {
    const f = new FormData();
    for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) f.append(k, v);
    return f;
  }
  async function getJSON(url) {
    const r = await fetch(url);
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || data.error) throw friendly(data || { message: 'HTTP ' + r.status });
    return data;
  }

  // ---------- motor real ----------

  let sdkPromise = null, initedAppId = null;
  /** Carrega o SDK oficial só quando a pessoa clica em "Entrar com Facebook" (e reconfigura se o App ID mudar). */
  async function loadSdk(appId) {
    await loadSdkScript();
    if (initedAppId !== appId) { root.FB.init({ appId, version: GRAPH_VERSION, cookie: false, xfbml: false }); initedAppId = appId; }
    return root.FB;
  }
  function loadSdkScript() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      root.fbAsyncInit = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      s.async = true; s.crossOrigin = 'anonymous';
      s.onerror = () => { sdkPromise = null; reject(new FbError('Não foi possível carregar o login do Facebook (bloqueador de anúncios ou sem internet?).')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function real(appId, configId) {
    let userToken = null;

    function login(FB, scopes) {
      // "Login do Facebook para Empresas" usa uma configuração (config_id) com as permissões já escolhidas no painel da Meta.
      const opts = configId ? { config_id: configId } : { scope: scopes.join(','), return_scopes: true, auth_type: 'rerequest' };
      return new Promise((resolve, reject) => {
        FB.login((res) => {
          if (res && res.authResponse && res.authResponse.accessToken) resolve(res.authResponse);
          else reject(new FbError('Login cancelado ou não autorizado.', 'login'));
        }, opts);
      });
    }

    return {
      kind: 'real',
      plannerUrl: PLANNER_URL,
      async connect() {
        if (!appId) throw new FbError('Falta o App ID do Facebook.');
        const FB = await loadSdk(appId);
        let auth;
        try { auth = await login(FB, SCOPES); } catch (e) {
          // Se a Meta não aceitar alguma permissão (ex.: publish_video foi descontinuada), tenta sem ela.
          if (e.code === 'login') throw e;
          auth = await login(FB, SCOPES.filter((s) => s !== 'publish_video'));
        }
        userToken = auth.accessToken;
        const me = await getJSON(GRAPH + '/me?fields=name&access_token=' + encodeURIComponent(userToken));
        // Confere o que a pessoa realmente autorizou, para explicar o que falta em vez de falhar no envio.
        const perms = await getJSON(GRAPH + '/me/permissions?access_token=' + encodeURIComponent(userToken)).catch(() => null);
        if (perms && Array.isArray(perms.data)) {
          const granted = new Set(perms.data.filter((p) => p.status === 'granted').map((p) => p.permission));
          const missing = ['pages_show_list', 'pages_manage_posts'].filter((p) => !granted.has(p));
          if (missing.length) {
            throw new FbError('O Facebook não concedeu: ' + missing.join(', ') + '. Confira se essas permissões estão no caso de uso' +
              (configId ? ' e na configuração do login' : '') + ', e entre de novo aceitando todas.', 'perms');
          }
        }
        return { name: me.name };
      },
      async pages() {
        const out = [];
        let url = GRAPH + '/me/accounts?fields=id,name,access_token,picture{url},tasks&limit=100&access_token=' + encodeURIComponent(userToken);
        while (url) {
          const data = await getJSON(url);
          for (const p of data.data || []) {
            const canPost = !p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE');
            out.push({ id: p.id, name: p.name, token: p.access_token, picture: p.picture && p.picture.data && p.picture.data.url, canPost });
          }
          url = data.paging && data.paging.next;
        }
        return out;
      },
      upload(opts) { return opts.kind === 'reel' ? uploadReel(opts) : uploadVideo(opts); },
      disconnect() { userToken = null; try { root.FB && root.FB.logout(() => {}); } catch (e) { /* já saiu */ } },
    };
  }

  const unix = (d) => Math.floor(d.getTime() / 1000);

  /** Vídeo de Página: envio em partes (start → transfer → finish), agendado com scheduled_publish_time. */
  async function uploadVideo({ page, blob, title, description, when, onProgress, signal }) {
    const url = GRAPH_VIDEO + '/' + page.id + '/videos';
    const start = await xhrPost(url, formOf({ access_token: page.token, upload_phase: 'start', file_size: blob.size }), { signal });
    const session = start.upload_session_id, videoId = start.video_id;
    let from = +start.start_offset, to = +start.end_offset;
    while (from < to) {
      const res = await xhrPost(url, formOf({
        access_token: page.token, upload_phase: 'transfer', upload_session_id: session, start_offset: from,
        video_file_chunk: blob.slice(from, to),
      }), { signal, onProgress: (sent) => onProgress && onProgress((from + sent) / blob.size) });
      from = +res.start_offset; to = +res.end_offset;
      if (onProgress) onProgress(from / blob.size);
    }
    await xhrPost(url, formOf({
      access_token: page.token, upload_phase: 'finish', upload_session_id: session,
      title: title || undefined, description, published: 'false', scheduled_publish_time: unix(when),
    }), { signal });
    return { id: videoId, url: 'https://www.facebook.com/' + videoId };
  }

  /** Reels de Página: start → envio do arquivo para o rupload → finish com video_state=SCHEDULED. */
  async function uploadReel({ page, blob, title, description, when, onProgress, signal }) {
    const url = GRAPH + '/' + page.id + '/video_reels';
    const start = await xhrPost(url, formOf({ access_token: page.token, upload_phase: 'start' }), { signal });
    await xhrPost(start.upload_url, null, {
      signal, body: blob,
      headers: { Authorization: 'OAuth ' + page.token, offset: '0', file_size: String(blob.size) },
      onProgress: (sent) => onProgress && onProgress(sent / blob.size),
    });
    await xhrPost(url, formOf({
      access_token: page.token, upload_phase: 'finish', video_id: start.video_id,
      video_state: 'SCHEDULED', scheduled_publish_time: unix(when), description, title: title || undefined,
    }), { signal });
    return { id: start.video_id, url: 'https://www.facebook.com/reel/' + start.video_id };
  }

  // ---------- motor simulado ----------

  function mock() {
    const scheduled = [];
    const sleep = (ms, signal) => new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new FbError('Envio cancelado.', 'abort')); }, { once: true });
    });
    return {
      kind: 'mock',
      plannerUrl: null,
      scheduled,
      async connect() { await sleep(300); return { name: 'Você (simulação)' }; },
      async pages() {
        await sleep(200);
        return [
          { id: 'sim-1', name: 'Minha Página (simulação)', token: 'sim', canPost: true },
          { id: 'sim-2', name: 'Loja Exemplo (simulação)', token: 'sim', canPost: true },
        ];
      },
      async upload({ page, blob, kind, title, description, when, onProgress, signal }) {
        const now = Date.now(), t = when.getTime();
        const max = new Date(); if (kind === 'reel') max.setDate(max.getDate() + 29); else max.setMonth(max.getMonth() + 6);
        const steps = 8;
        for (let i = 1; i <= steps; i++) { await sleep(40 + Math.min(200, blob.size / 2e5), signal); if (onProgress) onProgress(i / steps); }
        if (t < now + 10 * 60000 || t > max.getTime()) throw friendly({ code: 100, message: 'Invalid scheduled publish time (simulação)' });
        if (/\[simular erro\]/i.test(description)) throw friendly({ code: 6000, message: 'simulação' });
        const id = 'sim-' + Math.random().toString(36).slice(2, 10);
        scheduled.push({ id, page: page.name, kind, title, description, when, size: blob.size });
        return { id, url: null };
      },
      disconnect() {},
    };
  }

  const api = { real, mock, FbError, friendly, GRAPH_VERSION, SCOPES, PLANNER_URL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FacebookPages = api;
})(typeof window !== 'undefined' ? window : globalThis);
