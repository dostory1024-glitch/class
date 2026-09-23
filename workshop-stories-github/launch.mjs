import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const url = `http://localhost:${Number(process.env.PORT || 4977)}`;
async function isRunning() {
  try { return (await (await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(1000) })).json()).service === 'workshop-stories'; }
  catch { return false; }
}
try {
  if (!await isRunning()) {
    mkdirSync(new URL('data/', import.meta.url), { recursive: true });
    const log = openSync(new URL('data/server.log', import.meta.url), 'a');
    const child = spawn(process.execPath, ['server.mjs'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env });
    child.unref(); closeSync(log);
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(250);
      if (await isRunning()) { ready = true; break; }
    }
    if (!ready) throw new Error('Server did not start. Check data/server.log or the port.');
  }
  console.log(`Ready: ${url}`);
  if (!process.argv.includes('--no-open')) {
    const browser = spawn('explorer.exe', [url], { windowsHide: true, detached: true, stdio: 'ignore' });
    browser.unref();
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
