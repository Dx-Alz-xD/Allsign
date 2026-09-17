/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server for the Docker image; Vercel ignores this.
  output: 'standalone',
  // The desktop app's shared contract lives one level up.
  experimental: { externalDir: true },
};

export default nextConfig;
