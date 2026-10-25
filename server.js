/**
 * Aura AI — Web Server
 * Run:  node server.js
 * Open: http://localhost:3000
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif' : 'image/gif',
  '.webp': 'image/webp',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf' : 'font/ttf',
};

const srv = http.createServer((req, res) => {
  // Strip query string and resolve path
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const ct   = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type'               : ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control'              : 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma'                     : 'no-cache',
      'Expires'                    : '0',
      'Service-Worker-Allowed'     : '/',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // SPA fallback — serve index.html for unknown routes
      try {
        const index = fs.readFileSync(path.join(ROOT, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(index);
      } catch {
        res.writeHead(404); res.end('Not found');
      }
    } else {
      res.writeHead(500); res.end('Server error');
    }
  }
});

srv.listen(PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  const localIPs = Object.values(ifaces)
    .flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│         🤖  Aura AI Web Server          │');
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  Local:   http://localhost:${PORT}          │`);
  localIPs.forEach(ip =>
    console.log(`│  Network: http://${ip}:${PORT}${' '.repeat(Math.max(0, 19 - ip.length))}│`)
  );
  console.log('├─────────────────────────────────────────┤');
  console.log('│  Press Ctrl+C to stop the server        │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log('SERVER_READY');
});

srv.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. Try: PORT=3001 node server.js\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
