/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server for the Docker image; Vercel ignores this.
  output: 'standalone',
};

export default nextConfig;
