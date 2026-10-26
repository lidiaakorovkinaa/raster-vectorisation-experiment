import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../server/config.js';
import { ensureBuildNode } from './lib/node.mjs';

const node = ensureBuildNode();
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(node, [vite, 'build', '--config', path.join(ROOT, 'web', 'vite.config.ts')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ''}` },
});
if (result.error) {
  console.error('[build] failed to start Vite:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
