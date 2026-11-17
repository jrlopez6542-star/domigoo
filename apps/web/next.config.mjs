/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/legal/**": ["../../docs/legal/**"],
  },
};

export default nextConfig;
