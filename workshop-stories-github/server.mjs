import { createApp, lanAddress } from './src/server.mjs';
import { createConfiguredStore } from './src/configured-store.mjs';
import { existsSync } from 'node:fs';

if (!process.env.VERCEL && existsSync('.env.local')) process.loadEnvFile('.env.local');

const port = Number(process.env.PORT || 4977);
const host = process.env.HOST || '0.0.0.0';
const app = createApp({
  store: await createConfiguredStore(),
  publicUrl: process.env.PUBLIC_URL || '',
  deployment: !!process.env.VERCEL,
  deploymentUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
});
app.server.on('error', error => { console.error(`서버 실행 실패: ${error.message}`); process.exitCode = 1; app.close(); });
app.server.listen(port, host, () => {
  console.log(`망한 수업 자랑하기: http://localhost:${port}`);
  if (!process.env.VERCEL && lanAddress()) console.log(`같은 네트워크 참여: http://${lanAddress()}:${port}/join`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
