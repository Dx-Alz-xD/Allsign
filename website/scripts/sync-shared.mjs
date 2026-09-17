// Copies the code the website shares with the desktop app, so the website builds on its own (Vercel uploads
// only this folder). shared/types.ts and the desktop app's peer-link code stay the source of truth; run
// before dev/build, `--check` fails when a copy is stale.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const site = resolve(here, '..');
const check = process.argv.includes('--check');

// [source in the repository, copy inside the website]. The copies keep their `@/lib/...` and `@shared/...`
// imports, which the website's tsconfig resolves to the same places.
const FILES = [
  ['shared/types.ts', 'src/shared/types.ts'],
  ['frontend/src/lib/hud/types.ts', 'src/lib/hud/types.ts'],
  ['frontend/src/lib/peer/messages.ts', 'src/lib/peer/messages.ts'],
  ['frontend/src/lib/peer/outbox.ts', 'src/lib/peer/outbox.ts'],
  ['frontend/src/lib/peer/caregiverLink.ts', 'src/lib/peer/caregiverLink.ts'],
];

let stale = 0;
for (const [from, to] of FILES) {
  const source = resolve(repo, from);
  const target = resolve(site, to);
  if (!existsSync(source)) {
    // A checkout without the rest of the repository (a hosted build): the committed copy is used.
    if (!existsSync(target)) {
      console.error(`sync-shared: neither ${from} nor ${to} exists`);
      process.exit(1);
    }
    continue;
  }
  if (check) {
    if (!existsSync(target) || readFileSync(source, 'utf8') !== readFileSync(target, 'utf8')) {
      console.error(`sync-shared: ${to} is stale; run \`npm run shared:sync\``);
      stale++;
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
if (stale) process.exit(1);
