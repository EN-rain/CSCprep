import katex from 'katex'
import type { ReactNode } from 'react'

const UNICODE_FRAC: Record<string, string> = {
  '\u00bd': '\frac{1}{2}',
  '\u00bc': '\frac{1}{4}',
  '\u00be': '\frac{3}{4}',
  '\u2153': '\frac{1}{3}',
  '\u2154': '\frac{2}{3}',
  '\u2155': '\frac{1}{5}',
  '\u2156': '\frac{2}{5}',
  '\u2157': '\frac{3}{5}',
  '\u2158': '\frac{4}{5}',
  '\u2159': '\frac{1}{6}',
  '\u215a': '\frac{5}{6}',
  '\u215b': '\frac{1}{8}',
  '\u215c': '\frac{3}{8}',
  '\u215d': '\frac{5}{8}',
  '\u215e': '\frac{7}{8}',
  '\u2150': '\frac{1}{7}',
  '\u2151': '\frac{1}{9}',
  '\u2152': '\frac{1}{10}',
}

/** Convert plain / unicode fractions into $...$ so KaTeX can render them. */
export function injectFractionLatex(text: string): string {
  if (!text) return text

  let out = text

  // Unicode vulgar fractions (optionally after a whole number: "3\u00bd")
  out = out.replace(
    /(\d+)?([\u00bc\u00bd\u00be\u2150-\u215e])/gu,
    (_m, whole: string | undefined, frac: string) => {
      const body = UNICODE_FRAC[frac]
      if (!body) return _m
      return whole ? `$${whole}${body}$` : `$${body}$`
    },
  )

  // Mixed numbers: 3 1/4 or 3-1/4
  out = out.replace(
    /(?<!\$)\b(\d+)[\s-](\d+)\/(\d+)\b(?!\$)/g,
    (_m, whole: string, num: string, den: string) => {
      if (den === '0') return _m
      return `$${whole}\frac{${num}}{${den}}$`
    },
  )

  // Simple a/b — skip years like 1990/1999 and already-wrapped math
  out = out.replace(/(?<!\$)\b(\d{1,4})\/(\d{1,4})\b(?!\$)/g, (m, num: string, den: string) => {
    if (den === '0') return m
    // likely date range or code if both look like years
    if (
      num.length === 4 &&
      den.length === 4 &&
      (num.startsWith('19') || num.startsWith('20')) &&
      (den.startsWith('19') || den.startsWith('20'))
    ) {
      return m
    }
    return `$\frac{${num}}{${den}}$`
  })

  // Square roots already written as \sqrt{...} without dollars
  out = out.replace(/(?<!\$)\sqrt\{([^}]+)\}(?!\$)/g, (_m, inner: string) => `$\sqrt{${inner}}$`)

  return out
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    return tex
  }
}

/**
 * Split text on $...$ / $$...$$ and return React nodes with KaTeX HTML for math segments.
 */
export function MathText({ text, as: Comp = 'span' }: { text: string; as?: 'span' | 'p' | 'div' }) {
  const prepared = injectFractionLatex(text)
  const nodes: ReactNode[] = []
  // Match $$...$$ first, then $...$
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = re.exec(prepared)) !== null) {
    if (match.index > last) {
      nodes.push(prepared.slice(last, match.index))
    }
    const display = match[1] != null
    const tex = (match[1] ?? match[2] ?? '').trim()
    nodes.push(
      <span
        key={`m-${key++}`}
        className={display ? 'math-display' : 'math-inline'}
        dangerouslySetInnerHTML={{ __html: renderKatex(tex, display) }}
      />,
    )
    last = match.index + match[0].length
  }

  if (last < prepared.length) {
    nodes.push(prepared.slice(last))
  }

  if (nodes.length === 0) {
    return <>{text}</>
  }

  if (Comp === 'span') {
    return <span className="math-text">{nodes}</span>
  }
  if (Comp === 'p') {
    return <p className="math-text">{nodes}</p>
  }
  return <div className="math-text">{nodes}</div>
}

export function hasMathContent(text: string): boolean {
  if (!text) return false
  if (/\$[\s\S]+?\$/.test(text)) return true
  if (/[\u00bc\u00bd\u00be\u2150-\u215e]/.test(text)) return true
  if (/\b\d+[\s-]\d+\/\d+\b/.test(text)) return true
  if (/\b\d{1,4}\/\d{1,4}\b/.test(text)) return true
  return false
}
