/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['@zuri/prisma-postgres'],
  },
}

module.exports = nextConfig
