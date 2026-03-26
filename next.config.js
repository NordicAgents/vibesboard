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
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas', 'firebase-admin', '@google-cloud/storage', '@google-cloud/firestore', 'crypto-js', 'csv-parse', 'just-bash'],
  async headers() {
    return [
      {
        source: '/widget/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' }
        ]
      }
    ]
  },
  typescript: {
    // TODO: Fix Next.js 16 async params in route handlers, then remove this
    ignoreBuildErrors: true
  }
}

module.exports = nextConfig
