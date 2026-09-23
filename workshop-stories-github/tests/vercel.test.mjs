import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/index.mjs';
import { createApp } from '../src/server.mjs';

test('Vercel entrypoint serves pages and rejects unconfigured DB without listening itself', async t => {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/join', '/styles.css', '/app.js']) assert.equal((await fetch(base + path)).status, 200);
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.service, 'workshop-stories');
  assert.equal((await fetch(base + '/api/stories')).status, 503);
});

test('Vercel pre-parsed JSON requests still validate and save', async t => {
  const app = createApp({ dbPath: ':memory:' });
  const requestHandler = app.server.listeners('request')[0];
  const body = { nickname: '확인', intended: '계획', actual: '결과', requestId: 'vercel_request_0001' };
  const server = createServer((req, res) => { if (req.method === 'POST') req.body = body; return requestHandler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await app.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(base + '/api/stories');
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const saved = await fetch(base + '/api/stories', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } });
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).actual, '결과');
});
