import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';

const story = { nickname: '구름 선생님', intended: '모두 함께 발표하기', actual: '마이크만 열심히 발표했습니다.' };
test('owners and authenticated admins can manage stories; other participants cannot', async t => {
  const f = await fixture(t);
  const other = (await f.request('/api/stories')).headers.get('set-cookie').split(';')[0];
  const saved = await (await f.request('/api/stories', 'POST', { ...story, requestId: 'management_test_01' }, f.cookie)).json();
  const path = `/api/stories/${saved.id}`;
  assert.equal(saved.isOwner, true);
  assert.equal((await (await f.request('/api/stories', 'GET', undefined, other)).json()).stories[0].isOwner, false);
  assert.equal((await f.request(path, 'PUT', { ...story, isAdmin: true }, other)).status, 404);
  assert.equal((await f.request(path, 'DELETE', undefined, other)).status, 404);
  assert.equal((await f.request(path, 'PUT', { ...story, actual: '수정된 이야기' }, f.cookie)).status, 200);
  assert.equal((await f.request('/api/admin/login', 'POST', { password: 'wrong' }, other)).status, 401);
  const login = await f.request('/api/admin/login', 'POST', { password: '0000' }, other);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const admin = `${other}; ${login.headers.get('set-cookie').split(';')[0]}`;
  assert.equal((await (await f.request('/api/stories', 'GET', undefined, admin)).json()).isAdmin, true);
  assert.equal((await f.request(path, 'PUT', { ...story, actual: '관리자 수정' }, admin)).status, 200);
  const logout = await f.request('/api/admin/login', 'DELETE', undefined, admin);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request(path, 'DELETE', undefined, `${other}; workshop_admin=forged`)).status, 404);
  assert.equal((await f.request(path, 'DELETE', undefined, admin)).status, 200);
  assert.equal((await (await f.request('/api/stories')).json()).stories.length, 0);
});

test('admin sessions work across instances with shared secret and reject other secrets', async t => {
  const first = await fixture(t, { adminSessionSecret: 'shared-secret-for-test' });
  const login = await first.request('/api/admin/login', 'POST', { password: '0000' }, first.cookie);
  assert.equal(login.status, 200);
  const cookie = `${first.cookie}; ${login.headers.get('set-cookie').split(';')[0]}`;
  const second = await fixture(t, { adminSessionSecret: 'shared-secret-for-test' });
  assert.equal((await (await second.request('/api/stories', 'GET', undefined, cookie)).json()).isAdmin, true);
  const third = await fixture(t, { adminSessionSecret: 'different-secret' });
  assert.equal((await (await third.request('/api/stories', 'GET', undefined, cookie)).json()).isAdmin, false);
});
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'workshop-test-'));
  const app = createApp({ dbPath: join(dir, 'stories.sqlite'), ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body, cookie = '') {
    return fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const initial = await request('/api/stories');
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  return { app, base, request, cookie, dir };
}

test('submissions are shared across participants and survive reopening the database', async t => {
  const f = await fixture(t);
  const created = await f.request('/api/stories', 'POST', { ...story, requestId: 'submission_00000001' }, f.cookie);
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.equal(saved.nickname, story.nickname);
  const listing = await (await f.request('/api/stories')).json();
  assert.equal(listing.stories.length, 1);
  assert.equal(listing.stories[0].actual, story.actual);
  await f.app.close();
  const reopened = createApp({ dbPath: join(f.dir, 'stories.sqlite') });
  assert.equal(reopened.store.list('another-user')[0].actual, story.actual);
  await reopened.close();
});

test('submission retry with the same request ID creates only one story', async t => {
  const f = await fixture(t);
  const payload = { ...story, requestId: 'submission_00000002' };
  const [a, b] = await Promise.all([f.request('/api/stories', 'POST', payload, f.cookie), f.request('/api/stories', 'POST', payload, f.cookie)]);
  assert.equal((await a.json()).id, (await b.json()).id);
  assert.equal((await (await f.request('/api/stories')).json()).stories.length, 1);
});

test('hearts are idempotent, participant-specific, cancellable, and persistent', async t => {
  const f = await fixture(t);
  const saved = await (await f.request('/api/stories', 'POST', { ...story, requestId: 'submission_00000003' }, f.cookie)).json();
  const other = (await f.request('/api/stories')).headers.get('set-cookie').split(';')[0];
  const path = `/api/stories/${saved.id}/heart`;
  await Promise.all([f.request(path, 'PUT', { liked: true }, f.cookie), f.request(path, 'PUT', { liked: true }, f.cookie)]);
  let mine = await (await f.request('/api/stories', 'GET', undefined, f.cookie)).json();
  assert.equal(mine.stories[0].hearts, 1);
  assert.equal(mine.stories[0].liked, true);
  assert.equal((await (await f.request('/api/stories', 'GET', undefined, other)).json()).stories[0].liked, false);
  await f.request(path, 'PUT', { liked: true }, other);
  assert.equal((await (await f.request('/api/stories')).json()).stories[0].hearts, 2);
  await f.request(path, 'PUT', { liked: false }, f.cookie);
  await f.request(path, 'PUT', { liked: false }, f.cookie);
  assert.equal((await (await f.request('/api/stories')).json()).stories[0].hearts, 1);
  await f.app.close();
  const reopened = createApp({ dbPath: join(f.dir, 'stories.sqlite') });
  assert.equal(reopened.store.list(other.split('=')[1])[0].liked, true);
  await reopened.close();
});

test('invalid, blank, overlong and non-string input is rejected without saving', async t => {
  const f = await fixture(t);
  for (const patch of [{ nickname: '   ' }, { nickname: 9 }, { intended: '' }, { actual: '가'.repeat(201) }, { nickname: '가'.repeat(21) }]) {
    const response = await f.request('/api/stories', 'POST', { ...story, ...patch, requestId: 'submission_00000004' }, f.cookie);
    assert.equal(response.status, 400);
  }
  const valid = await f.request('/api/stories', 'POST', { ...story, actual: '😀'.repeat(200), requestId: 'submission_00000005' }, f.cookie);
  assert.equal(valid.status, 201);
  assert.equal((await (await f.request('/api/stories')).json()).stories.length, 1);
});

test('missing stories, invalid heart state, malformed JSON and cross-origin writes are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/stories/missing/heart', 'PUT', { liked: true }, f.cookie)).status, 404);
  assert.equal((await f.request('/api/stories/missing/heart', 'PUT', { liked: 'yes' }, f.cookie)).status, 400);
  const malformed = await fetch(f.base + '/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: f.cookie }, body: '{' });
  assert.equal(malformed.status, 400);
  const cross = await fetch(f.base + '/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example', cookie: f.cookie }, body: JSON.stringify(story) });
  assert.equal(cross.status, 403);
});

test('public URL controls QR participation link; private files are not served', async t => {
  const f = await fixture(t, { publicUrl: 'https://workshop.example' });
  const config = await (await f.request('/api/config')).json();
  assert.equal(config.joinUrl, 'https://workshop.example/join');
  const qr = await f.request('/api/qr');
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /<svg/);
  assert.equal((await f.request('/data/stories.sqlite')).status, 404);
  assert.equal((await f.request('/src/store.mjs')).status, 404);
});

test('Korean text remains intact when the request splits inside a UTF-8 character', async t => {
  const f = await fixture(t);
  const body = Buffer.from(JSON.stringify({ ...story, nickname: '가나다', requestId: 'submission_utf8_01' }));
  const split = body.indexOf(Buffer.from('가')) + 1;
  const saved = await new Promise((resolve, reject) => {
    const req = httpRequest(f.base + '/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: f.cookie } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 30);
  });
  assert.equal(saved.nickname, '가나다');
});

test('loading QR or config does not race to overwrite a visitor session', async t => {
  const f = await fixture(t);
  for (const path of ['/api/qr', '/api/config']) {
    const response = await f.request(path);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
