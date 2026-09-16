/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The desktop app's shared contract lives one level up.
  experimental: { externalDir: true },
};

export default nextConfig;
