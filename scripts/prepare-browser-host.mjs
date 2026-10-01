import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || host;
const args = ['build', '--release', '-p', 'unhook-browser-host', '--target', target];
execFileSync('cargo', args, { stdio: 'inherit' });
const name = `unhook-browser-host${target.includes('windows') ? '.exe' : ''}`;
const targetDirectory = resolve(process.env.CARGO_TARGET_DIR || 'target');
const source = resolve(targetDirectory, target, 'release', name);
const destinations = [resolve('src-tauri/binaries', `unhook-browser-host-${target}${target.includes('windows') ? '.exe' : ''}`)];
if (target === host) destinations.push(resolve(targetDirectory, 'debug', name));
for (const destination of destinations) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
