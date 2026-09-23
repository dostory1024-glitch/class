import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../src/store.mjs';
import { createPostgresStore } from '../src/postgres-store.mjs';
import { createConfiguredStore } from '../src/configured-store.mjs';

const payload = { nickname: '작성자', intended: '의도', actual: '실제', requestId: 'permission_test_001' };
const edit = { nickname: '수정한 이름', intended: '수정한 의도', actual: '수정한 실제' };
const denied = operation => assert.rejects(async () => operation(), { status: 404 });

async function fixture(t, backend) {
  if (backend === 'SQLite') {
    const dir = await mkdtemp(join(tmpdir(), 'story-permissions-'));
    const path = join(dir, 'stories.sqlite');
    const store = createStore(path);
    const db = new DatabaseSync(path);
    t.after(async () => { db.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
    return { store, hearts: async () => db.prepare('SELECT COUNT(*) AS count FROM hearts').get().count };
  }
  const pg = new PGlite();
  const store = createPostgresStore({
    query: async (text, values = []) => (await pg.query(text, values)).rows,
    transaction: statements => pg.transaction(async tx => {
      const results = [];
      for (const { text, values = [] } of statements) results.push((await tx.query(text, values)).rows);
      return results;
    })
  });
  t.after(() => pg.close());
  return { store, hearts: async () => Number((await pg.query('SELECT COUNT(*) AS count FROM workshop_hearts')).rows[0].count) };
}

for (const backend of ['SQLite', 'Postgres']) {
  test(`${backend}: ownership is private and edits require owner or trusted admin`, async t => {
    const { store } = await fixture(t, backend);
    const saved = await store.add(payload, 'owner');
    assert.equal(saved.isOwner, true);
    assert.equal('visitor' in saved, false);
    assert.equal((await store.list('stranger'))[0].isOwner, false);
    assert.equal((await store.heart(saved.id, 'owner', true)).isOwner, true);
    assert.equal((await store.heart(saved.id, 'stranger', true)).isOwner, false);
    await denied(() => store.update(saved.id, { ...edit, isAdmin: true, visitor: 'owner' }, 'stranger'));
    await denied(() => store.update(saved.id, edit, 'stranger', 'true'));
    await denied(() => store.update('missing', edit, 'owner', true));
    for (const bad of [{ nickname: ' ' }, { intended: 7 }, { actual: '가'.repeat(201) }]) {
      await assert.rejects(async () => store.update(saved.id, { ...edit, ...bad }, 'owner'), { status: 400 });
    }
    assert.equal((await store.list('owner'))[0].actual, payload.actual);
    const updated = await store.update(saved.id, edit, 'owner');
    assert.equal(updated.actual, edit.actual);
    assert.equal(updated.createdAt, saved.createdAt);
    assert.equal(updated.hearts, 2);
    assert.equal(updated.liked, true);
    assert.equal(updated.isOwner, true);
    assert.equal((await store.add(payload, 'owner')).id, saved.id);
    assert.equal((await store.add(payload, 'owner')).actual, edit.actual);
    const adminUpdated = await store.update(saved.id, { ...edit, actual: '관리자 수정' }, 'admin', true);
    assert.equal(adminUpdated.actual, '관리자 수정');
    assert.equal(adminUpdated.isOwner, false);
    assert.equal((await store.list('owner'))[0].isOwner, true);
  });

  test(`${backend}: authorized removal cascades hearts and unauthorized removal changes nothing`, async t => {
    const { store, hearts } = await fixture(t, backend);
    const saved = await store.add(payload, 'owner');
    await store.heart(saved.id, 'stranger', true);
    await denied(() => store.remove(saved.id, 'stranger'));
    await denied(() => store.remove(saved.id, 'stranger', 'true'));
    assert.equal((await store.list('owner')).length, 1);
    assert.equal(await hearts(), 1);
    assert.deepEqual(await store.remove(saved.id, 'owner'), { deleted: true });
    assert.equal(await hearts(), 0);
    await denied(() => store.remove(saved.id, 'owner', true));
    const next = await store.add(payload, 'owner');
    await store.heart(next.id, 'owner', true);
    assert.deepEqual(await store.remove(next.id, 'admin', true), { deleted: true });
    assert.equal(await hearts(), 0);
    assert.equal((await store.list('owner')).length, 0);
  });
}

test('unconfigured deployed store rejects editing and removal with 503', async () => {
  const store = await createConfiguredStore({ VERCEL: '1' });
  await assert.rejects(async () => store.update('id', edit, 'owner'), { status: 503 });
  await assert.rejects(async () => store.remove('id', 'owner'), { status: 503 });
});
