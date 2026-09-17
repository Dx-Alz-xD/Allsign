import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both packages hide these files behind export maps, so they are addressed by path.
const modules = resolve(dirname(fileURLToPath(import.meta.url)), 'node_modules');

/**
 * ONNX Runtime's bundle points at itself with `new URL('ort.webgpu.bundle.min.mjs', import.meta.url)`, so webpack
 * copies it into static/media as a plain asset. It is already minified ES module code, and the production minifier
 * parses such assets as classic scripts and fails on `import.meta`; mark the copies as minified so it skips them.
 */
class SkipMinifyingPrebuiltOrt {
  constructor(webpack) {
    this.webpack = webpack;
  }

  apply(compiler) {
    const { Compilation } = this.webpack;
    compiler.hooks.compilation.tap('SkipMinifyingPrebuiltOrt', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'SkipMinifyingPrebuiltOrt', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1 },
        (assets) => {
          for (const name of Object.keys(assets)) {
            if (/(^|\/)ort[.-][^/]*\.mjs$/.test(name)) compilation.updateAsset(name, (source) => source, { minimized: true });
          }
        },
      );
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export to ./out, served inside Electron via the app:// protocol.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config, { webpack }) => {
    config.plugins.push(new SkipMinifyingPrebuiltOrt(webpack));
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
