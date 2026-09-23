import { createApp } from '../src/server.mjs';
import { createConfiguredStore } from '../src/configured-store.mjs';

const app = createApp({
  store: await createConfiguredStore({ ...process.env, VERCEL: '1' }),
  publicUrl: process.env.PUBLIC_URL || '',
  deployment: true,
  deploymentUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
});

// Reuse the request handler without opening a listening port in a function.
export default app.server.listeners('request')[0];
