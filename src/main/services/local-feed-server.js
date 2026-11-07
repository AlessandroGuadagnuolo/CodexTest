import http from 'node:http';
import { buildICalendar } from './ical.js';

export const FEED_HOST = '127.0.0.1';
export const FEED_PORT = 48537;
export const FEED_URL = 'http://' + FEED_HOST + ':' + FEED_PORT + '/calendar.ics';

export class LocalFeedServer {
  constructor(getItems) {
    this.getItems = getItems;
    this.server = null;
    this.status = { ready: false, url: FEED_URL, error: '' };
  }

  getStatus() {
    return { ...this.status };
  }

  async start() {
    if (this.server?.listening) return this.getStatus();
    this.server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', FEED_URL);
      if (requestUrl.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('ok');
        return;
      }
      if (requestUrl.pathname !== '/calendar.ics' || (request.method !== 'GET' && request.method !== 'HEAD')) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Not found');
        return;
      }
      try {
        const body = Buffer.from(buildICalendar(this.getItems()), 'utf8');
        response.writeHead(200, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'Content-Length': body.length
        });
        if (request.method === 'HEAD') response.end();
        else response.end(body);
      } catch (_error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Calendar feed unavailable');
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(FEED_PORT, FEED_HOST);
    }).then(() => {
      this.status = { ready: true, url: FEED_URL, error: '' };
    }).catch((error) => {
      const message = error.code === 'EADDRINUSE'
        ? 'La porta locale 48537 è già in uso. Chiudi il processo che la occupa e riavvia l’app.'
        : 'Non è stato possibile avviare il feed locale: ' + error.message;
      this.status = { ready: false, url: FEED_URL, error: message };
      this.server = null;
    });
    return this.getStatus();
  }

  stop() {
    if (this.server?.listening) this.server.close();
    this.server = null;
    this.status = { ready: false, url: FEED_URL, error: '' };
  }
}
