import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const state = '.wrangler/state';
mkdirSync(state, { recursive: true });
for (const file of readdirSync('drizzle').filter(x => x.endsWith('.sql')).sort()) {
  const marker = `${state}/applied-${file}`;
  if (existsSync(marker)) continue;
  const result = spawnSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', state, '--file', `drizzle/${file}`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeFileSync(marker, 'applied\n');
}
const child = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', state, '--ip', '0.0.0.0', '--port', '8787', '--inspector-port', '0'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
