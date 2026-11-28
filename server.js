import http from 'http';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Muat .env.local jika ada (untuk VPS / lokal tanpa Vercel CLI)
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  // 1. Routing API (/api/*)
  if (pathname.startsWith('/api/')) {
    const modName = pathname.replace('/api/', '').replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.resolve('api', `${modName}.js`);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }

    req.query = Object.fromEntries(parsed.searchParams.entries());
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    }

    // Adapter res.status().json() / send() agar 100% kompatibel dengan Vercel
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
    res.send = (txt) => res.end(txt);

    try {
      const mod = await import(pathToFileURL(filePath).href);
      return await mod.default(req, res);
    } catch (err) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // 2. Routing File Statis (public/)
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const staticPath = path.resolve('public', rel);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return fs.createReadStream(staticPath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => console.log(`Server Kesiswaan aktif di http://localhost:${PORT}`));
