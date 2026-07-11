import type { HybridMemory } from './types.ts'

export interface SerializeOptions {
  /** Only render the table of contents (descriptions, no bodies) */
  tocOnly?: boolean
  /** Cap total characters for omnipresent bodies */
  maxOmnipresentTokens?: number
}

/**
 * Renders a set of memories as a tree-structured block for injection into the
 * agent system prompt — matching the format from the design doc.
 *
 * Example output:
 *   [/preferences/style] Be concise and action-oriented.
 *   [/contact/history/incidents] Recurring interest in subnet details ...
 *   [/runbooks] [... 3 more here]
 */
export function serializeTreeToC(
  memories: HybridMemory[],
  opts: SerializeOptions = {},
): string {
  if (!memories.length) return ''

  // Build tree from slash-delimited keys
  const tree = buildTree(memories)
  const lines: string[] = []
  renderNode(tree, '', lines, opts)
  return lines.join('\n')
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface TreeNode {
  key: string
  memory?: HybridMemory
  children: Map<string, TreeNode>
}

function buildTree(memories: HybridMemory[]): TreeNode {
  const root: TreeNode = { key: '', children: new Map() }

  for (const mem of memories) {
    const parts = mem.key.replace(/^\//, '').split('/').filter(Boolean)
    let node = root
    let path = ''

    for (let i = 0; i < parts.length; i++) {
      path += '/' + parts[i]
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], { key: path, children: new Map() })
      }
      node = node.children.get(parts[i])!
      if (i === parts.length - 1) {
        node.memory = mem
      }
    }
  }

  return root
}

function renderNode(
  node: TreeNode,
  indent: string,
  lines: string[],
  opts: SerializeOptions,
): void {
  for (const [, child] of node.children) {
    const mem = child.memory
    const hasChildren = child.children.size > 0
    const childCount = countLeaves(child)

    if (mem) {
      const isOmnipresent = mem.presenceClass === 'omnipresent'
      const showBody = isOmnipresent && !opts.tocOnly

      if (showBody) {
        lines.push(`${indent}[${mem.key}] ${mem.content}`)
      } else if (mem.description) {
        lines.push(`${indent}[${mem.key}] ${mem.description} ...`)
      } else {
        lines.push(`${indent}[${mem.key}]`)
      }
    } else if (hasChildren) {
      if (childCount > 3) {
        // Collapse deep subtrees
        lines.push(`${indent}[${child.key}] [... ${childCount} more here]`)
        continue
      }
      lines.push(`${indent}[${child.key}]`)
    }

    if (hasChildren && !(childCount > 3)) {
      renderNode(child, indent + '  ', lines, opts)
    }
  }
}

function countLeaves(node: TreeNode): number {
  if (!node.children.size) return node.memory ? 1 : 0
  let count = node.memory ? 1 : 0
  for (const [, child] of node.children) {
    count += countLeaves(child)
  }
  return count
}
