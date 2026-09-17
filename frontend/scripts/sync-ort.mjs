// Copies the ONNX Runtime web binaries the speech recognizer needs into public/ort/, so the packaged app
// loads them from its own files (app://) instead of a CDN. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../node_modules/onnxruntime-web/dist');
const target = resolve(here, '../public/ort');
// Every variant: the WebGPU bundle asks for the asyncify build, the WASM fallback for the plain one.
const FILES = readdirSync(source).filter((name) => name.startsWith('ort-wasm-simd-threaded') && (name.endsWith('.mjs') || name.endsWith('.wasm')));

mkdirSync(target, { recursive: true });
for (const name of FILES) {
  const from = resolve(source, name);
  if (!existsSync(from)) {
    console.error(`sync-ort: ${name} is missing from onnxruntime-web; run npm install`);
    process.exit(1);
  }
  copyFileSync(from, resolve(target, name));
}
