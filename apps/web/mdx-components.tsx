import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import Image, { type ImageProps } from 'next/image'

import { cn } from '@vibesboard/utils'
import { Callout } from '@/components/docs/mdx/callout'
import { Steps, Step } from '@/components/docs/mdx/steps'
import { Cards, Card } from '@/components/docs/mdx/cards'
import { CodeGroup, CodeGroupItem } from '@/components/docs/mdx/code-group'
import { Kbd } from '@/components/docs/mdx/kbd'
import { DocsPre } from '@/components/docs/mdx/pre'

const docsComponents: MDXComponents = {
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        'scroll-mt-24 text-3xl font-semibold tracking-tight text-text-primary',
        className
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        'group scroll-mt-24 text-2xl font-semibold tracking-tight text-text-primary',
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        'group scroll-mt-24 text-xl font-semibold tracking-tight text-text-primary',
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn('scroll-mt-24 text-base font-semibold text-text-primary', className)}
      {...props}
    />
  ),
  a: ({ href = '', className, children, ...props }) => {
    const isInternal = href.startsWith('/') || href.startsWith('#')
    if (isInternal) {
      return (
        <Link
          href={href}
          className={cn(
            'decoration-accent-orange/50 font-medium text-text-primary underline underline-offset-4 hover:decoration-accent-orange',
            className
          )}
          {...props}
        >
          {children}
        </Link>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'decoration-accent-orange/50 font-medium text-text-primary underline underline-offset-4 hover:decoration-accent-orange',
          className
        )}
        {...props}
      >
        {children}
      </a>
    )
  },
  img: props => {
    const { alt, ...rest } = props as ImageProps
    return (
      <Image
        sizes="100vw"
        className="rounded-xl border border-border-warm"
        style={{ width: '100%', height: 'auto' }}
        alt={alt ?? ''}
        {...rest}
      />
    )
  },
  hr: props => <hr className="my-8 border-border-warm" {...props} />,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'border-accent-orange/60 border-l-2 pl-4 italic text-text-secondary',
        className
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-border-warm">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  ),
  thead: props => <thead className="bg-bg-surface" {...props} />,
  th: ({ className, ...props }) => (
    <th
      className={cn(
        'border-b border-border-warm px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-text-tertiary',
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn('border-b border-border-warm px-3 py-2 align-top', className)}
      {...props}
    />
  ),
  pre: DocsPre,
  code: ({ className, children, ...props }) => {
    // rehype-pretty-code marks the fenced-block <code> with data-language;
    // that one renders bare since DocsPre already supplies the chrome.
    if ('data-language' in props) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className={cn(
          'rounded-md border border-border-warm bg-bg-surface px-1.5 py-0.5 font-mono text-[0.85em] text-text-primary',
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  },
  Callout,
  Steps,
  Step,
  Cards,
  Card,
  CodeGroup,
  CodeGroupItem,
  Kbd
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...docsComponents, ...components }
}
