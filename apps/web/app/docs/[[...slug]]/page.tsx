import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  docFileExists,
  extractHeadings,
  loadDocComponent,
  readDocRaw
} from '@/lib/docs/content'
import {
  DOCS_FLAT_PAGES,
  findAdjacentDocPages,
  findDocPage
} from '@/lib/docs/nav'
import { DocsPager } from '@/components/docs/docs-pager'
import { DocsToc } from '@/components/docs/docs-toc'

interface DocsPageParams {
  params: Promise<{ slug?: string[] }>
}

export async function generateStaticParams() {
  return [
    { slug: undefined },
    ...DOCS_FLAT_PAGES.map(page => ({ slug: page.slug.split('/') }))
  ]
}

export async function generateMetadata({
  params
}: DocsPageParams): Promise<Metadata> {
  const { slug = [] } = await params
  if (!docFileExists(slug)) return {}

  const { data } = readDocRaw(slug)
  const navPage = findDocPage(slug.join('/'))

  return {
    title: data.title ?? navPage?.title ?? 'Docs',
    description: data.description ?? navPage?.description
  }
}

export default async function DocsContentPage({ params }: DocsPageParams) {
  const { slug = [] } = await params

  if (!docFileExists(slug)) {
    notFound()
  }

  const Content = await loadDocComponent(slug)
  const { content: raw } = readDocRaw(slug)
  const headings = extractHeadings(raw)
  const joinedSlug = slug.join('/')

  const { prev, next } =
    joinedSlug === ''
      ? { prev: null, next: DOCS_FLAT_PAGES[0] ?? null }
      : findAdjacentDocPages(joinedSlug)

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 py-2">
        <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-switzer prose-a:no-underline prose-code:before:content-none prose-code:after:content-none">
          <Content />
        </div>
        <DocsPager prev={prev} next={next} />
      </article>
      <aside className="hidden w-56 shrink-0 xl:block">
        <DocsToc headings={headings} />
      </aside>
    </div>
  )
}
