import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../server/config.js';
import { ensureBuildNode } from './lib/node.mjs';

const node = ensureBuildNode();
const env = { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ''}` };
const server = spawn(node, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: 'inherit' });
const vite = spawn(node, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', path.join(ROOT, 'web', 'vite.config.ts')], { cwd: ROOT, env, stdio: 'inherit' });
const stop = () => { server.kill('SIGINT'); vite.kill('SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => { vite.kill('SIGINT'); process.exit(code ?? 0); });
vite.on('exit', (code) => { if (code !== 0) { server.kill('SIGINT'); process.exit(code ?? 0); } });
