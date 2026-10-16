'use strict';
// Local test server: static files + /api/rpc (real handlers) on top of the in-memory mock database.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { server: mockServer, tables } = require('./mock-supabase');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

(async () => {
  const mock = mockServer();
  await new Promise((r) => mock.listen(0, r));
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + mock.address().port;
  process.env.SUPABASE_SERVICE_KEY = 'test';
  process.env.SESSION_SECRET = 'e2e';
  const rpc = require('../api/rpc.js');

  const app = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/rpc') return rpc(req, res);
    if (url.pathname === '/__reset') {
      Object.values(tables).forEach((t) => { t.rows = []; t.next = 1; });
      return res.end('ok');
    }
    let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  app.listen(Number(process.env.PORT || 4173), () => console.log('READY'));
})();
