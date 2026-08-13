import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createMDX from '@next/mdx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // bun workspace lives two levels up — tell Next to trace deps from there.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.githubusercontent.com'
      },
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com'
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com'
      }
    ]
  },
  // Ensure pdf-parse and its native canvas dependency are available
  // to the Node.js runtime (and serverless targets) without bundling
  // their worker files incorrectly.
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas', '@google-cloud/storage', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'crypto-js', 'csv-parse', 'just-bash'],
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

// Plugins are referenced by importable string specifier, not by imported
// function, so this still works under Turbopack (the default bundler here) —
// see "Using Plugins with Turbopack" in the Next.js MDX guide.
//
// `remark-gfm-mdx` (not `remark-gfm`) is intentional: the app already pins
// remark-gfm@3 for react-markdown@8's chat renderer, which is incompatible
// with the newer remark/mdast-util-from-markdown stack @next/mdx compiles
// MDX with (mismatched GFM-table tokenizer internals throw at build time).
// remark-gfm-mdx is remark-gfm@4 installed under an alias so both renderers
// get the major version they each actually need.
const withMDX = createMDX({
  options: {
    remarkPlugins: [
      'remark-gfm-mdx',
      'remark-frontmatter',
      ['remark-mdx-frontmatter', { name: 'frontmatter' }]
    ],
    rehypePlugins: [
      'rehype-slug',
      [
        'rehype-autolink-headings',
        {
          behavior: 'append',
          properties: {
            className: ['docs-heading-anchor'],
            ariaLabel: 'Link to this section'
          },
          content: {
            type: 'element',
            tagName: 'span',
            properties: { className: ['docs-heading-anchor-icon'] },
            children: [{ type: 'text', value: '#' }]
          }
        }
      ],
      [
        'rehype-pretty-code',
        {
          theme: { light: 'github-light', dark: 'github-dark-dimmed' },
          keepBackground: false,
          defaultLang: 'text'
        }
      ]
    ]
  }
})

export default withMDX(nextConfig)
