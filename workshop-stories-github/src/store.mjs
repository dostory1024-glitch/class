import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { InputError, validateStory, validateStoryFields } from './validation.mjs';

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, nickname TEXT NOT NULL, intended TEXT NOT NULL,
      actual TEXT NOT NULL, createdAt TEXT NOT NULL, visitor TEXT NOT NULL,
      requestId TEXT NOT NULL, UNIQUE(visitor, requestId)
    );
    CREATE TABLE IF NOT EXISTS hearts (
      storyId TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      visitor TEXT NOT NULL, PRIMARY KEY(storyId, visitor)
    );`);
  let closed = false;
  const select = `SELECT s.id, s.nickname, s.intended, s.actual, s.createdAt,
    (SELECT COUNT(*) FROM hearts WHERE storyId = s.id) AS hearts,
    EXISTS(SELECT 1 FROM hearts WHERE storyId = s.id AND visitor = ?) AS liked,
    s.visitor = ? AS isOwner
    FROM stories s`;
  const normalize = row => row && ({ ...row, liked: !!row.liked, isOwner: !!row.isOwner });
  const get = (id, visitor) => normalize(db.prepare(`${select} WHERE s.id = ?`).get(visitor, visitor, id));
  return {
    list(visitor) { return db.prepare(`${select} ORDER BY s.createdAt DESC, s.rowid DESC`).all(visitor, visitor).map(normalize); },
    add(body, visitor) {
      const { nickname, intended, actual } = validateStory(body);
      const existing = db.prepare('SELECT id FROM stories WHERE visitor = ? AND requestId = ?').get(visitor, body.requestId);
      if (existing) return get(existing.id, visitor);
      const id = randomUUID();
      db.prepare('INSERT INTO stories VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, nickname, intended, actual, new Date().toISOString(), visitor, body.requestId);
      return get(id, visitor);
    },
    update(id, body, visitor, isAdmin = false) {
      const { nickname, intended, actual } = validateStoryFields(body);
      const saved = db.prepare('UPDATE stories SET nickname = ?, intended = ?, actual = ? WHERE id = ? AND (visitor = ? OR ? = 1) RETURNING id')
        .get(nickname, intended, actual, id, visitor, isAdmin === true ? 1 : 0);
      if (!saved) throw new InputError('사연을 찾을 수 없습니다.', 404);
      return get(id, visitor);
    },
    remove(id, visitor, isAdmin = false) {
      const deleted = db.prepare('DELETE FROM stories WHERE id = ? AND (visitor = ? OR ? = 1) RETURNING id')
        .get(id, visitor, isAdmin === true ? 1 : 0);
      if (!deleted) throw new InputError('사연을 찾을 수 없습니다.', 404);
      return { deleted: true };
    },
    heart(id, visitor, liked) {
      if (typeof liked !== 'boolean') throw new InputError('공감 상태가 올바르지 않습니다.');
      if (!get(id, visitor)) throw new InputError('사연을 찾을 수 없습니다.', 404);
      if (liked) db.prepare('INSERT OR IGNORE INTO hearts VALUES (?, ?)').run(id, visitor);
      else db.prepare('DELETE FROM hearts WHERE storyId = ? AND visitor = ?').run(id, visitor);
      return get(id, visitor);
    },
    close() { if (!closed) { db.close(); closed = true; } }
  };
}
