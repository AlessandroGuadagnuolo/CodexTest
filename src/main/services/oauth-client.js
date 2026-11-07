import crypto from 'node:crypto';
import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';

function randomBase64Url(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function htmlPage(title, message) {
  return '<!doctype html><html lang="it"><meta charset="utf-8"><title>' + title +
    '</title><body style="font:16px Segoe UI,Arial;padding:36px;color:#26354b">' +
    '<h2>' + title + '</h2><p>' + message +
    '</p><p>Puoi chiudere questa finestra e tornare a Calendario Unificato.</p></body></html>';
}

export class OAuthClient {
  constructor(openExternal) {
    this.openExternal = openExternal;
  }

  async authorize(options) {
    const host = options.provider === 'google' ? '127.0.0.1' : 'localhost';
    const callbackPath = '/';
    const listener = { server: http.createServer(), timer: null };
    await new Promise((resolve, reject) => {
      listener.server.once('error', reject);
      listener.server.listen(0, host, resolve);
    });
    listener.port = listener.server.address().port;

    const redirectUri = 'http://' + host + ':' + listener.port + callbackPath;
    const state = randomBase64Url(24);
    const verifier = randomBase64Url(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorizationUrl = new URL(options.authorizationEndpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: options.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: options.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(options.extraParams || {})
    }).toString();

    let resolveCallback;
    let rejectCallback;
    const callbackPromise = new Promise((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    listener.timer = setTimeout(() => {
      listener.server.close();
      rejectCallback(new Error('Accesso scaduto. Riprova e completa il passaggio nel browser.'));
    }, 240000);
    listener.server.on('request', (request, response) => {
      const callbackUrl = new URL(request.url, 'http://' + host);
      if (callbackUrl.pathname !== callbackPath) {
        response.writeHead(404).end();
        return;
      }
      const providerError = callbackUrl.searchParams.get('error');
      response.writeHead(providerError ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(htmlPage(providerError ? 'Accesso non completato' : 'Accesso completato',
        providerError ? 'Il provider ha restituito un errore. Torna all’app e riprova.' : 'Autorizzazione ricevuta.'));
      clearTimeout(listener.timer);
      listener.server.close();
      if (providerError) rejectCallback(new Error('Accesso OAuth rifiutato: ' + providerError));
      else resolveCallback({
        code: callbackUrl.searchParams.get('code'),
        state: callbackUrl.searchParams.get('state')
      });
    });

    try {
      await this.openExternal(authorizationUrl.toString());
      const callback = await callbackPromise;
      if (callback.state !== state) throw new Error('Risposta OAuth non valida (state non corrispondente).');
      if (!callback.code) throw new Error('Il provider non ha restituito un codice di accesso.');
      return await this.exchangeCode(options, callback.code, verifier, redirectUri);
    } finally {
      clearTimeout(listener.timer);
      if (listener.server.listening) listener.server.close();
    }
  }

  async exchangeCode(options, code, verifier, redirectUri) {
    const body = new URLSearchParams({
      client_id: options.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });
    if (options.clientSecret) body.set('client_secret', options.clientSecret);
    const response = await fetch(options.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error('Scambio del codice OAuth non riuscito: ' + (payload.error_description || payload.error || response.status));
    }
    return payload;
  }
}

export async function refreshToken(options, refreshTokenValue) {
  const body = new URLSearchParams({
    client_id: options.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    scope: options.scopes.join(' ')
  });
  if (options.clientSecret) body.set('client_secret', options.clientSecret);
  const response = await fetch(options.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error('Rinnovo del token non riuscito: ' + (payload.error_description || payload.error || response.status));
  }
  return payload;
}
