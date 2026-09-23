import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore } from '../src/postgres-store.mjs';
import { createConfiguredStore } from '../src/configured-store.mjs';
import { createApp } from '../src/server.mjs';

const payload = { nickname: '별빛쌤', intended: '함께 배우는 수업 😀', actual: '예상하지 못한 질문이 쏟아졌어요.', requestId: 'postgres_story_0001' };
const visitor = 'ec925c60-caa3-4f02-a502-cbfeec75d29a';
async function fixture(t) {
  const pg = new PGlite();
  const executor = {
    query: async (text, values = []) => (await pg.query(text, values)).rows,
    transaction: statements => pg.transaction(async tx => {
      const results = [];
      for (const { text, values = [] } of statements) results.push((await tx.query(text, values)).rows);
      return results;
    })
  };
  t.after(() => pg.close());
  return { pg, executor, store: createPostgresStore(executor) };
}

test('Postgres persists stories across store instances and prevents retried insert duplication', async t => {
  const { store, executor } = await fixture(t);
  const saved = await store.add(payload, visitor);
  const retry = await store.add(payload, visitor);
  assert.equal(retry.id, saved.id);
  const secondInstance = createPostgresStore(executor);
  const stories = await secondInstance.list('second-visitor');
  assert.equal(stories.length, 1);
  assert.equal(stories[0].actual, payload.actual);
  assert.equal(stories[0].intended, payload.intended);
  assert.equal(typeof stories[0].createdAt, 'string');
  assert.equal(stories[0].hearts, 0);
  assert.equal(stories[0].liked, false);
});

test('Postgres hearts are shared, idempotent and independently cancellable', async t => {
  const { store } = await fixture(t);
  const saved = await store.add(payload, visitor);
  await Promise.all([store.heart(saved.id, visitor, true), store.heart(saved.id, visitor, true)]);
  assert.equal((await store.list(visitor))[0].hearts, 1);
  await store.heart(saved.id, 'second-visitor', true);
  const mine = (await store.list(visitor))[0];
  assert.equal(mine.hearts, 2);
  assert.equal(mine.liked, true);
  await store.heart(saved.id, visitor, false);
  await store.heart(saved.id, visitor, false);
  assert.equal((await store.list(visitor))[0].hearts, 1);
  assert.equal((await store.list(visitor))[0].liked, false);
  assert.equal((await store.list('second-visitor'))[0].liked, true);
  await assert.rejects(store.heart('missing', visitor, true), { status: 404 });
  await assert.rejects(store.heart('missing', visitor, false), { status: 404 });
});

test('Postgres validates fields and stores SQL-like text literally', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.add({ ...payload, nickname: ' ' }, visitor), { status: 400 });
  await assert.rejects(store.add({ ...payload, actual: '가'.repeat(201) }, visitor), { status: 400 });
  await assert.rejects(store.add({ ...payload, requestId: null }, visitor), { status: 400 });
  const saved = await store.add({ ...payload, actual: "'); DROP TABLE workshop_stories; --" }, visitor);
  assert.equal(saved.actual, "'); DROP TABLE workshop_stories; --");
  assert.equal((await store.list(visitor)).length, 1);
});

test('HTTP API awaits remote storage results and uses deployment HTTPS origin for QR and cookies', async t => {
  const { store } = await fixture(t);
  const app = createApp({ store, deployment: true, deploymentUrl: 'https://stories.example' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const initial = await fetch(base + '/api/stories');
  assert.match(initial.headers.get('set-cookie'), /; Secure/);
  const cookie = initial.headers.get('set-cookie').split(';')[0];
  const created = await fetch(base + '/api/stories', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).nickname, payload.nickname);
  assert.equal((await (await fetch(base + '/api/stories')).json()).stories.length, 1);
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.joinUrl, 'https://stories.example/join');
  assert.equal(config.isLocal, false);
});

test('Vercel without a database rejects saves rather than writing to temporary files', async () => {
  const store = await createConfiguredStore({ VERCEL: '1' });
  await assert.rejects(store.add(payload, visitor), { status: 503 });
  await assert.rejects(store.list(visitor), { status: 503 });
});

test('Supabase browser roles cannot bypass the app to read or insert story records', async t => {
  const { store, pg } = await fixture(t);
  const saved = await store.add(payload, visitor);
  await store.heart(saved.id, visitor, true);
  await pg.exec('CREATE ROLE browser_anon; GRANT USAGE ON SCHEMA public TO browser_anon; GRANT SELECT, INSERT ON workshop_stories, workshop_hearts TO browser_anon');
  await pg.exec('SET ROLE browser_anon');
  try {
    assert.equal((await pg.query('SELECT * FROM workshop_stories')).rows.length, 0);
    assert.equal((await pg.query('SELECT * FROM workshop_hearts')).rows.length, 0);
    await assert.rejects(pg.query(`INSERT INTO workshop_stories (id,nickname,intended,actual,visitor,request_id) VALUES ('unauthorized','익명','의도','실제','visitor','request')`), /row-level security/);
    await assert.rejects(pg.query('INSERT INTO workshop_hearts (story_id,visitor) VALUES ($1,$2)', [saved.id,'browser_anon']), /row-level security/);
  } finally { await pg.exec('RESET ROLE'); }
  assert.equal((await store.list(visitor)).length, 1);
});
