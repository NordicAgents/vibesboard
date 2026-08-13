import 'server-only'
import fs from 'node:fs'
import path from 'node:path'

import { DOCS_CONTENT_DIR, extractHeadings, readDocRaw } from './content'
import { findDocPage } from './nav'

export interface DocSearchResult {
  slug: string
  title: string
  description: string
  matchedHeading?: string
}

interface IndexedDoc {
  slug: string
  title: string
  description: string
  headings: string[]
  body: string
}

let cachedIndex: IndexedDoc[] | null = null

function walkSlugs(): string[] {
  const slugs: string[] = []

  function walk(dir: string, prefix: string[]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...prefix, entry.name])
        continue
      }
      if (!entry.name.endsWith('.mdx')) continue
      const base = entry.name.replace(/\.mdx$/, '')
      if (base === 'index' && prefix.length === 0) {
        slugs.push('')
        continue
      }
      slugs.push([...prefix, base].join('/'))
    }
  }

  walk(DOCS_CONTENT_DIR, [])
  return slugs
}

function buildIndex(): IndexedDoc[] {
  return walkSlugs().map(slug => {
    const slugParts = slug === '' ? [] : slug.split('/')
    const navPage = findDocPage(slug)
    const { data, content } = readDocRaw(slugParts)
    const headings = extractHeadings(content).map(h => h.text)
    const strippedBody = content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*_>`~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      slug,
      title: data.title ?? navPage?.title ?? slug,
      description: data.description ?? navPage?.description ?? '',
      headings,
      body: strippedBody
    }
  })
}

function getIndex(): IndexedDoc[] {
  if (!cachedIndex) {
    cachedIndex = buildIndex()
  }
  return cachedIndex
}

export function searchDocs(query: string, limit = 8): DocSearchResult[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const scored = getIndex().map(doc => {
    let score = 0
    let matchedHeading: string | undefined

    if (doc.title.toLowerCase().includes(q)) score += 10
    if (doc.description.toLowerCase().includes(q)) score += 5
    for (const heading of doc.headings) {
      if (heading.toLowerCase().includes(q)) {
        score += 3
        matchedHeading ??= heading
      }
    }
    if (doc.body.toLowerCase().includes(q)) score += 1

    return { doc, score, matchedHeading }
  })

  return scored
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, matchedHeading }) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      matchedHeading
    }))
}
