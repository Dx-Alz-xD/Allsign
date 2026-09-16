// Copies src/worklets/*.js into public/worklets/ so Next.js and Electron serve
// them as static assets. `--check` only reports drift (non-zero exit), for CI.
//
//   node scripts/sync-worklets.mjs          # sync
//   node scripts/sync-worklets.mjs --check  # verify
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'worklets');
const target = join(root, 'public', 'worklets');
const check = process.argv.includes('--check');

mkdirSync(target, { recursive: true });

let drift = 0;
for (const name of readdirSync(source).filter((file) => file.endsWith('.js'))) {
  const from = join(source, name);
  const to = join(target, name);
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) continue;

  if (check) {
    console.error(`public/worklets/${name} differs from src/worklets/${name}`);
    drift++;
    continue;
  }
  copyFileSync(from, to);
  console.log(`synced public/worklets/${name}`);
}

process.exit(drift > 0 ? 1 : 0);
