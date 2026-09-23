import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import postgres from 'postgres';
import { InputError, validateStory, validateStoryFields } from './validation.mjs';

const schema = [
  { text: 'SELECT pg_advisory_xact_lock(4977001)' },
  { text: `CREATE TABLE IF NOT EXISTS workshop_stories (
    id TEXT PRIMARY KEY, nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 20),
    intended TEXT NOT NULL CHECK (char_length(intended) BETWEEN 1 AND 200),
    actual TEXT NOT NULL CHECK (char_length(actual) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), visitor TEXT NOT NULL,
    request_id TEXT NOT NULL, UNIQUE(visitor, request_id)
  )` },
  { text: `CREATE TABLE IF NOT EXISTS workshop_hearts (
    story_id TEXT NOT NULL REFERENCES workshop_stories(id) ON DELETE CASCADE,
    visitor TEXT NOT NULL, PRIMARY KEY(story_id, visitor)
  )` },
  { text: 'CREATE INDEX IF NOT EXISTS workshop_stories_created_at ON workshop_stories(created_at DESC, id DESC)' },
  { text: 'ALTER TABLE workshop_stories ENABLE ROW LEVEL SECURITY' },
  { text: 'ALTER TABLE workshop_hearts ENABLE ROW LEVEL SECURITY' }
];

const select = `SELECT s.id, s.nickname, s.intended, s.actual, s.created_at AS "createdAt",
  (SELECT COUNT(*)::integer FROM workshop_hearts WHERE story_id = s.id) AS hearts,
  EXISTS(SELECT 1 FROM workshop_hearts WHERE story_id = s.id AND visitor = $1) AS liked,
  s.visitor = $1 AS "isOwner"
  FROM workshop_stories s`;
const normalize = row => row && ({ ...row, createdAt: new Date(row.createdAt).toISOString(), hearts: Number(row.hearts), liked: !!row.liked, isOwner: !!row.isOwner });

/** The executor exposes parameterized query(text, values) and an atomic transaction of statements. */
export function createPostgresStore(executor) {
  let initialization;
  function ready() {
    return initialization ||= executor.transaction(schema).catch(error => { initialization = null; throw error; });
  }
  async function get(id, visitor) { return normalize((await executor.query(`${select} WHERE s.id = $2`, [visitor, id]))[0]); }
  return {
    async list(visitor) {
      await ready();
      return (await executor.query(`${select} ORDER BY s.created_at DESC, s.id DESC`, [visitor])).map(normalize);
    },
    async add(body, visitor) {
      const { nickname, intended, actual, requestId } = validateStory(body);
      await ready();
      // A unique key and a no-op update handle retries even across separate function instances.
      const [saved] = await executor.query(`INSERT INTO workshop_stories (id, nickname, intended, actual, visitor, request_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (visitor, request_id) DO UPDATE SET request_id = EXCLUDED.request_id
        RETURNING id`, [randomUUID(), nickname, intended, actual, visitor, requestId]);
      return get(saved.id, visitor);
    },
    async update(id, body, visitor, isAdmin = false) {
      const { nickname, intended, actual } = validateStoryFields(body);
      await ready();
      const results = await executor.transaction([
        { text: 'UPDATE workshop_stories SET nickname = $1, intended = $2, actual = $3 WHERE id = $4 AND (visitor = $5 OR $6::boolean) RETURNING id', values: [nickname, intended, actual, id, visitor, isAdmin === true] },
        { text: `${select} WHERE s.id = $2`, values: [visitor, id] }
      ]);
      if (!results[0].length) throw new InputError('사연을 찾을 수 없습니다.', 404);
      return normalize(results[1][0]);
    },
    async remove(id, visitor, isAdmin = false) {
      await ready();
      const deleted = await executor.query('DELETE FROM workshop_stories WHERE id = $1 AND (visitor = $2 OR $3::boolean) RETURNING id', [id, visitor, isAdmin === true]);
      if (!deleted.length) throw new InputError('사연을 찾을 수 없습니다.', 404);
      return { deleted: true };
    },
    async heart(id, visitor, liked) {
      if (typeof liked !== 'boolean') throw new InputError('공감 상태가 올바르지 않습니다.');
      await ready();
      try {
        const results = await executor.transaction([
          { text: 'SELECT id FROM workshop_stories WHERE id = $1 FOR UPDATE', values: [id] },
          { text: liked ? 'INSERT INTO workshop_hearts (story_id, visitor) VALUES ($1, $2) ON CONFLICT DO NOTHING' : 'DELETE FROM workshop_hearts WHERE story_id = $1 AND visitor = $2', values: [id, visitor] },
          { text: `${select} WHERE s.id = $2`, values: [visitor, id] }
        ]);
        const saved = normalize(results[2][0]);
        if (!saved) throw new InputError('사연을 찾을 수 없습니다.', 404);
        return saved;
      } catch (error) {
        if (error.code === '23503') throw new InputError('사연을 찾을 수 없습니다.', 404);
        throw error;
      }
    },
    async close() { await executor.close?.(); }
  };
}

export function createSupabaseStore(connectionString) {
  const sql = postgres(connectionString, {
    prepare: false,
    max: 3,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates, readFileSync(new URL('./certs/supabase-ca.crt', import.meta.url), 'utf8')] }
  });
  return createPostgresStore({
    query: (text, values = []) => sql.unsafe(text, values),
    transaction: statements => sql.begin(async transaction => {
      const results = [];
      for (const { text, values = [] } of statements) results.push(await transaction.unsafe(text, values));
      return results;
    }),
    close: () => sql.end({ timeout: 5 })
  });
}
