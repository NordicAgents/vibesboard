/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.githubusercontent.com'
      },
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com'
      }
    ]
  },
  // Ensure pdf-parse and its native canvas dependency are available
  // to the Node.js runtime (and serverless targets) without bundling
  // their worker files incorrectly.
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas']
}

module.exports = nextConfig
