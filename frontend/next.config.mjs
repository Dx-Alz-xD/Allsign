import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both packages hide these files behind export maps, so they are addressed by path.
const modules = resolve(dirname(fileURLToPath(import.meta.url)), 'node_modules');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export to ./out, served inside Electron via the app:// protocol.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config) => {
    // The on-device recognizer (workers/asr.worker.ts) runs Transformers.js in the browser. Webpack would
    // otherwise pick the package's Node build, which needs onnxruntime-node and wasm files that never ship.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@huggingface/transformers$': resolve(modules, '@huggingface/transformers/dist/transformers.web.js'),
      'onnxruntime-web/webgpu$': resolve(modules, 'onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'),
      'onnxruntime-node$': false,
      sharp$: false,
    };
    return config;
  },
};

export default nextConfig;
