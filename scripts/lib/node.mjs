import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../server/config.js';

const TOOLS = path.join(ROOT, '.tools');
const SIGNED = path.join(TOOLS, 'node-vecbench');
const ENTITLEMENTS = path.join(TOOLS, 'entitlements.plist');

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
`;

/**
 * The DeepSeek runtime is hardened and refuses to dlopen native Rollup/esbuild
 * addons signed by other teams. A re-signed copy of the same Node binary with
 * library validation disabled lets the build run without touching system Node.
 * On other platforms / normal Node installations this is a no-op.
 */
export function ensureBuildNode() {
  if (process.platform !== 'darwin') return process.execPath;
  try {
    mkdirSync(TOOLS, { recursive: true });
    if (!existsSync(SIGNED) || statSync(SIGNED).size !== statSync(process.execPath).size) {
      copyFileSync(process.execPath, SIGNED);
      writeFileSync(ENTITLEMENTS, PLIST, 'utf8');
      const result = spawnSync('codesign', ['--force', '--sign', '-', '--entitlements', ENTITLEMENTS, '--options', 'runtime', SIGNED], { encoding: 'utf8' });
      if (result.status !== 0) {
        console.warn('[build] codesign failed, falling back to the current Node binary:', (result.stderr || '').trim());
        return process.execPath;
      }
      const probe = spawnSync(SIGNED, ['-e', '0'], { stdio: 'ignore' });
      if (probe.status !== 0) return process.execPath;
    }
    return SIGNED;
  } catch (error) {
    console.warn('[build] cannot prepare signed Node copy:', error.message);
    return process.execPath;
  }
}
