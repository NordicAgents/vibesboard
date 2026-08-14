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
    // Baseline hardening applied to every response. Deliberately NOT a script
    // CSP (the app relies on Next's inline runtime; a strict script-src needs
    // nonce plumbing — tracked as a follow-up). frame-ancestors is handled
    // per-path below so the embeddable widget keeps working.
    const baseline = [
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload'
      },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
      }
    ]
    return [
      { source: '/:path*', headers: baseline },
      {
        // The widget is intentionally embeddable on customer sites.
        source: '/widget/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' }
        ]
      },
      {
        // Everything except the widget refuses cross-origin framing.
        source: '/((?!widget/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }
        ]
      }
    ]
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
