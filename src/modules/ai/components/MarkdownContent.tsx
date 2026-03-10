import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Lightweight Markdown renderer for AI chat responses.
 * Supports: fenced code blocks, inline code, bold, italic,
 * headers, ordered/unordered lists, horizontal rules, and tables.
 */
export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseBlocks(content)
  return (
    <div className="markdown-content space-y-2 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  )
}

// ── Block types ──

type BlockNode =
  | { type: 'code'; lang: string; content: string }
  | { type: 'heading'; level: number; content: string }
  | { type: 'hr' }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; content: string }

// ── Block parser ──

function parseBlocks(text: string): BlockNode[] {
  const blocks: BlockNode[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)/)
    if (codeMatch) {
      const lang = codeMatch[1] || ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') })
      continue
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] })
      i++
      continue
    }

    // Table (| header | header |)
    if (/^\|(.+)\|/.test(line) && i + 1 < lines.length && /^\|[-:\s|]+\|/.test(lines[i + 1])) {
      const headers = line.split('|').slice(1, -1).map(s => s.trim())
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && /^\|(.+)\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim()))
        i++
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // Empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,4}\s/) &&
      !lines[i].match(/^[-*_]{3,}\s*$/) &&
      !lines[i].match(/^[\s]*[-*+]\s/) &&
      !lines[i].match(/^[\s]*\d+[.)]\s/) &&
      !(lines[i].match(/^\|(.+)\|/) && i + 1 < lines.length && /^\|[-:\s|]+\|/.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('\n') })
    }
  }

  return blocks
}

// ── Block renderer ──

function Block({ block }: { block: BlockNode }) {
  switch (block.type) {
    case 'code':
      return <CodeBlock lang={block.lang} content={block.content} />
    case 'heading':
      return <Heading level={block.level} content={block.content} />
    case 'hr':
      return <hr className="border-gray-200 dark:border-white/10" />
    case 'ul':
      return (
        <ul className="list-disc pl-5 space-y-0.5">
          {block.items.map((item, i) => (
            <li key={i}><InlineContent text={item} /></li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="list-decimal pl-5 space-y-0.5">
          {block.items.map((item, i) => (
            <li key={i}><InlineContent text={item} /></li>
          ))}
        </ol>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/[0.08]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/[0.04]">
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-white/[0.08]">
                    <InlineContent text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-b last:border-b-0 border-gray-100 dark:border-white/[0.04]">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                      <InlineContent text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap break-words">
          <InlineContent text={block.content} />
        </p>
      )
  }
}

// ── Code block with copy button ──

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-white/[0.08]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-gray-100 dark:bg-white/[0.06] border-b border-gray-200 dark:border-white/[0.06]">
        <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
          {lang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {copied
            ? <><Check size={12} className="text-emerald-500" /><span className="text-emerald-500">已复制</span></>
            : <><Copy size={12} /><span>复制</span></>
          }
        </button>
      </div>
      {/* Code content */}
      <pre className="px-3 py-2.5 overflow-x-auto bg-gray-50 dark:bg-black/30 text-xs leading-5">
        <code className="font-mono text-gray-700 dark:text-gray-300">{content}</code>
      </pre>
    </div>
  )
}

// ── Heading ──

function Heading({ level, content }: { level: number; content: string }) {
  const cls = [
    'text-base font-bold',      // h1
    'text-[15px] font-bold',    // h2
    'text-sm font-semibold',    // h3
    'text-sm font-medium',      // h4
  ][level - 1] || 'text-sm font-medium'

  return (
    <div className={`${cls} text-gray-900 dark:text-gray-100`}>
      <InlineContent text={content} />
    </div>
  )
}

// ── Inline content parser ──
// Handles: **bold**, *italic*, `code`, [link](url)

function InlineContent({ text }: { text: string }) {
  const parts = parseInline(text)
  return <>{parts.map((p, i) => <InlinePart key={i} part={p} />)}</>
}

type InlinePart =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; url: string }

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  // Match inline patterns: code, bold, italic, links
  const regex = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      parts.push({ type: 'code', content: match[1] })
    } else if (match[2] !== undefined) {
      parts.push({ type: 'bold', content: match[2] })
    } else if (match[3] !== undefined) {
      parts.push({ type: 'italic', content: match[3] })
    } else if (match[4] !== undefined && match[5] !== undefined) {
      parts.push({ type: 'link', text: match[4], url: match[5] })
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }]
}

function InlinePart({ part }: { part: InlinePart }) {
  switch (part.type) {
    case 'text':
      return <>{part.content}</>
    case 'bold':
      return <strong className="font-semibold">{part.content}</strong>
    case 'italic':
      return <em>{part.content}</em>
    case 'code':
      return (
        <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.08] text-[13px] font-mono text-emerald-700 dark:text-emerald-300">
          {part.content}
        </code>
      )
    case 'link':
      return (
        <a href={part.url} target="_blank" rel="noopener noreferrer"
           className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">
          {part.text}
        </a>
      )
  }
}
