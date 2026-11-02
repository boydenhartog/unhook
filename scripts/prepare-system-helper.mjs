import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || host;
if (target.includes('apple-darwin')) {
  execFileSync('cargo', ['build', '--release', '-p', 'unhook-system-helper', '--target', target], {
    stdio: 'inherit',
  });
  mkdirSync('src-tauri/binaries', { recursive: true });
  const executable = resolve('src-tauri/binaries/unhook-system-helper');
  copyFileSync(
    resolve(process.env.CARGO_TARGET_DIR || 'target', target, 'release/unhook-system-helper'),
    executable,
  );
  chmodSync(executable, 0o755);
  // Preserve the identifier when Tauri signs the nested executable later.
  // Ad-hoc builds fail embedded service authentication; the installed package
  // route separately authorizes app code hashes installed by root.
  const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
  execFileSync(
    '/usr/bin/codesign',
    [
      '--force',
      '--sign',
      identity,
      '--identifier',
      'org.unhook.system-helper',
      '--options',
      'runtime',
      executable,
    ],
    { stdio: 'inherit' },
  );
}
