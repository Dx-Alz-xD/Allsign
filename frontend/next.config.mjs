/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export to ./out, served inside Electron via the app:// protocol.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
