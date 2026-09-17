// Copies the shared contract into the website so it builds on its own (Vercel uploads only this folder).
// Run before dev/build; `--check` fails when the copy is stale. shared/types.ts stays the source of truth.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../shared/types.ts');
const target = resolve(here, '../src/shared/types.ts');
const check = process.argv.includes('--check');

if (!existsSync(source)) {
  // A checkout without the rest of the repository (a hosted build): use the committed copy.
  if (!existsSync(target)) {
    console.error('sync-shared: neither ../shared/types.ts nor src/shared/types.ts exists');
    process.exit(1);
  }
  process.exit(0);
}
if (check) {
  const same = existsSync(target) && readFileSync(source, 'utf8') === readFileSync(target, 'utf8');
  if (!same) {
    console.error('sync-shared: src/shared/types.ts is stale; run `npm run shared:sync`');
    process.exit(1);
  }
  process.exit(0);
}
copyFileSync(source, target);
