import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('dist/unhook-companion');
mkdirSync(destination, { recursive: true });
for (const file of readdirSync('extension')) {
  if (!file.endsWith('.test.js') && /\.(json|js|html|css)$/.test(file)) {
    copyFileSync(resolve('extension', file), resolve(destination, file));
  }
}
