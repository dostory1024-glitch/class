import { fileURLToPath } from 'node:url';
import { InputError } from './validation.mjs';

export async function createConfiguredStore(env = process.env) {
  const connectionString = env.DATABASE_URL || env.POSTGRES_URL;
  if (connectionString) {
    const { createSupabaseStore } = await import('./postgres-store.mjs');
    return createSupabaseStore(connectionString);
  }
  if (env.VERCEL) {
    const unavailable = async () => { throw new InputError('저장소 연결이 준비되지 않았습니다. 운영자에게 문의해 주세요.', 503); };
    return { list: unavailable, add: unavailable, update: unavailable, remove: unavailable, heart: unavailable, close() {} };
  }
  const { createStore } = await import('./store.mjs');
  return createStore(env.DATA_FILE || fileURLToPath(new URL('../data/stories.sqlite', import.meta.url)));
}
