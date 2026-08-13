import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import GithubSlugger from 'github-slugger'
import type { ComponentType } from 'react'

export const DOCS_CONTENT_DIR = path.join(process.cwd(), 'content/docs')

export interface DocHeading {
  depth: 2 | 3
  text: string
  id: string
}

export interface DocFrontmatter {
  title?: string
  description?: string
}

function slugToFile(slug: string[]): string {
  const joined = slug.length === 0 ? 'index' : slug.join('/')
  return path.join(DOCS_CONTENT_DIR, `${joined}.mdx`)
}

export function docFileExists(slug: string[]): boolean {
  return fs.existsSync(slugToFile(slug))
}

/**
 * Reads a doc's raw markdown off disk (frontmatter stripped by gray-matter).
 * Used for heading extraction and as a metadata fallback — separate from
 * `loadDocComponent`, which compiles the file for rendering.
 */
export function readDocRaw(slug: string[]): {
  data: DocFrontmatter
  content: string
} {
  const raw = fs.readFileSync(slugToFile(slug), 'utf8')
  const { data, content } = matter(raw)
  return { data: data as DocFrontmatter, content }
}

/**
 * Extracts h2/h3 headings for the "on this page" TOC. Slugs are generated
 * with `github-slugger`, the same package `rehype-slug` uses internally, so
 * these ids match the anchor ids rehype-slug assigns during MDX compilation.
 */
export function extractHeadings(markdown: string): DocHeading[] {
  const slugger = new GithubSlugger()
  const headings: DocHeading[] = []
  const withoutCodeFences = markdown.replace(/```[\s\S]*?```/g, '')
  const headingPattern = /^(#{2,3})\s+(.+)$/gm

  let match: RegExpExecArray | null
  while ((match = headingPattern.exec(withoutCodeFences))) {
    const depth = match[1].length as 2 | 3
    const text = match[2].replace(/[*_`]/g, '').trim()
    headings.push({ depth, text, id: slugger.slug(text) })
  }
  return headings
}

export async function loadDocComponent(slug: string[]): Promise<ComponentType> {
  const joined = slug.length === 0 ? 'index' : slug.join('/')
  const mod = await import(`@/content/docs/${joined}.mdx`)
  return mod.default as ComponentType
}
