import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createStore } from './store.mjs';
import { InputError } from './validation.mjs';

const publicRoot = new URL('../public/', import.meta.url);
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/join', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/icons.js', ['icons.js', 'text/javascript; charset=utf-8']],
  ['/samples.js', ['samples.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/fonts/PretendardVariable.woff2', ['fonts/PretendardVariable.woff2', 'font/woff2']],
]);

export function lanAddress() {
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, values]) => values.filter(v => v.family === 'IPv4' && !v.internal).map(v => ({ name, address: v.address })));
  return addresses.find(v => !/vEthernet|VMware|VirtualBox|tailscale|docker/i.test(v.name) && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address))?.address;
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON 형식으로 전송해 주세요.', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new InputError('내용이 너무 깁니다.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('요청 내용이 올바르지 않습니다.'); }
}

export function createApp({ dbPath = fileURLToPath(new URL('../data/stories.sqlite', import.meta.url)), publicUrl = '', store: suppliedStore, deployment = false, deploymentUrl = '', adminPassword = process.env.ADMIN_PASSWORD || '0000', adminSessionSecret = process.env.ADMIN_SESSION_SECRET || process.env.DATABASE_URL || process.env.POSTGRES_URL || randomBytes(32).toString('hex') } = {}) {
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must start with http:// or https://');
  const store = suppliedStore || createStore(dbPath);
  const ip = deployment ? undefined : lanAddress();
  const qrCache = new Map();
  const secureCookie = deployment || publicUrl.startsWith('https:') ? '; Secure' : '';
  const sign = value => createHmac('sha256', adminSessionSecret).update(`${adminPassword}:${value}`).digest('hex');
  const passwordMatches = password => typeof password === 'string' && timingSafeEqual(createHash('sha256').update(password).digest(), createHash('sha256').update(adminPassword).digest());
  function isAdminSession(req, visitor) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)workshop_admin=(\d+\.[a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token || !visitor) return false;
    const [expires, signature] = token.split('.');
    return Number(expires) > Date.now() && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(`${visitor}:${expires}`), 'hex'));
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    function json(status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const mutating = ['POST', 'PUT', 'DELETE'].includes(req.method);
      if (mutating && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const allowed = origin.host === url.host || (publicUrl && origin.origin === new URL(publicUrl).origin) || (deploymentUrl && origin.origin === new URL(deploymentUrl).origin);
        if (!allowed) throw new InputError('허용되지 않은 요청입니다.', 403);
      }
      if (url.pathname.startsWith('/api/')) {
        let visitor = req.headers.cookie?.match(/(?:^|;\s*)workshop_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
        if (!visitor && mutating) throw new InputError('연결을 새로 확인한 뒤 다시 시도해 주세요.', 401);
        if (!visitor && url.pathname === '/api/stories' && req.method === 'GET') {
          visitor = randomUUID();
          res.setHeader('Set-Cookie', `workshop_visitor=${visitor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secureCookie}`);
        }
        const isAdmin = isAdminSession(req, visitor);
        if (url.pathname === '/api/admin/login' && req.method === 'POST') {
          if (!passwordMatches((await readJson(req))?.password)) throw new InputError('관리자 비밀번호가 올바르지 않습니다.', 401);
          const expires = String(Date.now() + 8 * 60 * 60 * 1000);
          res.setHeader('Set-Cookie', `workshop_admin=${expires}.${sign(`${visitor}:${expires}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`);
          return json(200, { isAdmin: true });
        }
        if (url.pathname === '/api/admin/login' && req.method === 'DELETE') {
          res.setHeader('Set-Cookie', `workshop_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);
          return json(200, { isAdmin: false });
        }
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        const host = loopback && ip ? `${ip}:${url.port || 80}` : url.host;
        const origin = publicUrl ? new URL(publicUrl).origin : deployment ? (loopback && deploymentUrl ? new URL(deploymentUrl).origin : `https://${url.host}`) : `http://${host}`;
        const joinUrl = `${origin}/join`;
        if (url.pathname === '/api/config' && req.method === 'GET') return json(200, { service: 'workshop-stories', joinUrl, isLocal: !publicUrl && !deployment, refreshMs: 3000 });
        if (url.pathname === '/api/qr' && req.method === 'GET') {
          if (!qrCache.has(joinUrl)) {
            if (qrCache.size > 8) qrCache.clear();
            qrCache.set(joinUrl, await QRCode.toString(joinUrl, { type: 'svg', margin: 4, width: 320, color: { dark: '#1d1d1f', light: '#ffffff' }, errorCorrectionLevel: 'M' }));
          }
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
          return res.end(qrCache.get(joinUrl));
        }
        if (url.pathname === '/api/stories' && req.method === 'GET') return json(200, { stories: await store.list(visitor), isAdmin });
        if (url.pathname === '/api/stories' && req.method === 'POST') return json(201, await store.add(await readJson(req), visitor));
        const story = url.pathname.match(/^\/api\/stories\/([\w-]+)$/);
        if (story && req.method === 'PUT') return json(200, await store.update(story[1], await readJson(req), visitor, isAdmin));
        if (story && req.method === 'DELETE') return json(200, await store.remove(story[1], visitor, isAdmin));
        const heart = url.pathname.match(/^\/api\/stories\/([\w-]+)\/heart$/);
        if (heart && req.method === 'PUT') return json(200, await store.heart(heart[1], visitor, (await readJson(req))?.liked));
        return json(404, { error: '요청을 찾을 수 없습니다.' });
      }
      const asset = staticFiles.get(url.pathname);
      if (!asset || !['GET', 'HEAD'].includes(req.method)) return json(404, { error: '페이지를 찾을 수 없습니다.' });
      const data = await readFile(new URL(asset[0], publicRoot));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  let closing;
  return { server, store, close() {
    return closing ||= new Promise((resolve, reject) => {
      const finish = () => Promise.resolve().then(() => store.close()).then(resolve, reject);
      if (!server.listening) { finish(); return; }
      server.close(finish);
      server.closeAllConnections();
    });
  } };
}
