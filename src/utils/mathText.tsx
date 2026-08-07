import katex from 'katex'
import type { ReactNode } from 'react'

/** Literal backslash — avoids JS '\f' / '\b' / '\s' escape traps. */
const BS = String.fromCharCode(92)

const UNICODE_FRAC: Record<string, string> = {
  '½': BS + 'frac{1}{2}',
  '¼': BS + 'frac{1}{4}',
  '¾': BS + 'frac{3}{4}',
  '⅓': BS + 'frac{1}{3}',
  '⅔': BS + 'frac{2}{3}',
  '⅕': BS + 'frac{1}{5}',
  '⅖': BS + 'frac{2}{5}',
  '⅗': BS + 'frac{3}{5}',
  '⅘': BS + 'frac{4}{5}',
  '⅙': BS + 'frac{1}{6}',
  '⅚': BS + 'frac{5}{6}',
  '⅛': BS + 'frac{1}{8}',
  '⅜': BS + 'frac{3}{8}',
  '⅝': BS + 'frac{5}{8}',
  '⅞': BS + 'frac{7}{8}',
  '⅐': BS + 'frac{1}{7}',
  '⅑': BS + 'frac{1}{9}',
  '⅒': BS + 'frac{1}{10}',
}

const UNICODE_SUP: Record<string, string> = {
  '²': '2',
  '³': '3',
  '¹': '1',
  '⁰': '0',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

function texFrac(num: string, den: string, whole?: string): string {
  // Brace both parts so signs/expressions stay intact: \frac{-6}{a-3}
  const core = BS + 'frac{' + num + '}{' + den + '}'
  return whole ? '$' + whole + core + '$' : '$' + core + '$'
}

function texParenFrac(num: string, den: string): string {
  return '$(' + BS + 'frac{' + num + '}{' + den + '})$'
}

function texSqrt(arg: string, coef?: string): string {
  const core = BS + 'sqrt{' + arg + '}'
  return coef ? '$' + coef + core + '$' : '$' + core + '$'
}

function texPow(base: string, exp: string): string {
  return '$' + base + '^{' + exp + '}$'
}

/** Convert plain / unicode math into $...$ so KaTeX can render it. */
export function injectFractionLatex(text: string): string {
  if (!text) return text

  let out = text

  // Unicode vulgar fractions (optionally after a whole number: 3⅛)
  out = out.replace(
    /(\d+)?([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒])/gu,
    (_m, whole: string | undefined, frac: string) => {
      const body = UNICODE_FRAC[frac]
      if (!body) return _m
      return whole ? '$' + whole + body + '$' : '$' + body + '$'
    },
  )

  // Mixed numbers: 3 1/8 or 3-1/8
  out = out.replace(
    /(?<!\$)\b(\d+)[\u00a0\s-](\d+)\/(\d+)\b(?!\$)/g,
    (_m, whole: string, num: string, den: string) => {
      if (den === '0') return _m
      return texFrac(num, den, whole)
    },
  )

  // Algebraic fraction: -6/(a - 3) or 3/(a + 2)
  out = out.replace(
    /(?<!\$)(-?\d+)\s*\/\s*\(([^)]+)\)/g,
    (_m, num: string, den: string) => {
      const cleanDen = den.replace(/\s+/g, '')
      return texFrac(num, cleanDen)
    },
  )

  // Parenthesized numeric fractions: (3/8)
  out = out.replace(/(?<!\$)\((\d{1,4})\/(\d{1,4})\)(?!\$)/g, (_m, num: string, den: string) => {
    if (den === '0') return _m
    return texParenFrac(num, den)
  })

  // Signed or plain numeric a/b: -1/3, 1/2
  out = out.replace(/(?<!\$)(-?)\b(\d{1,4})\/(\d{1,4})\b(?!\$)/g, (m, sign: string, num: string, den: string) => {
    if (den === '0') return m
    if (
      num.length === 4 &&
      den.length === 4 &&
      (num.startsWith('19') || num.startsWith('20')) &&
      (den.startsWith('19') || den.startsWith('20'))
    ) {
      return m
    }
    return texFrac(sign ? sign + num : num, den)
  })

  // Exponents: x^2, 10^3, n^(-1)
  out = out.replace(
    /(?<!\$)\b([A-Za-z]|\d+(?:\.\d+)?)\^(\d+|\(\s*-?\d+\s*\))(?!\$)/g,
    (_m, base: string, exp: string) => texPow(base, exp.replace(/[()]/g, '')),
  )

  // Unicode superscripts: x², 10³
  out = out.replace(
    /(?<!\$)([A-Za-z0-9)\]])([¹²³⁰⁴⁵⁶⁷⁸⁹]+)/g,
    (_m, base: string, sups: string) => {
      const digits = [...sups].map((ch) => UNICODE_SUP[ch] ?? '').join('')
      if (!digits) return _m
      return texPow(base, digits)
    },
  )

  // Plain sqrt(...)
  out = out.replace(/(?<!\$)\bsqrt\s*\(([^)]+)\)/gi, (_m, inner: string) => {
    return texSqrt(inner.replace(/,/g, '').trim())
  })

  // Already written \sqrt{...} without dollars (BS + 'sqrt{...}')
  out = out.replace(
    new RegExp('(?<!\\$)' + BS.replace(/\\/g, '\\\\') + 'sqrt\\{([^}]+)\\}(?!\\$)', 'g'),
    (_m, inner: string) => texSqrt(inner),
  )

  // Coefficient + unicode radical: 5√6
  out = out.replace(
    /(?<!\$)(\d+)\s*[√∛]\s*(\d+(?:\.\d+)?)/g,
    (_m, coef: string, arg: string) => texSqrt(arg, coef),
  )

  // Unicode radical with parentheses: √(25 x 6)
  out = out.replace(/(?<!\$)[√∛]\s*\(([^)]+)\)/g, (_m, inner: string) => {
    const texInner = inner
      .replace(/\s*[x×*]\s*/gi, ' ' + BS + 'times ')
      .replace(/\s+/g, ' ')
      .trim()
    return texSqrt(texInner)
  })

  // Unicode radical + number/decimal: √150, √0.00000081
  out = out.replace(/(?<!\$)[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, arg: string) => texSqrt(arg))

  return out
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      strict: 'ignore',
      output: 'html',
      trust: false,
    })
  } catch {
    return tex
  }
}

export function MathText({ text, as: Comp = 'span' }: { text: string; as?: 'span' | 'p' | 'div' }) {
  const prepared = injectFractionLatex(text)
  const nodes: ReactNode[] = []
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
  if (/[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒]/.test(text)) return true
  if (/[√∛]/.test(text)) return true
  if (/\bsqrt\s*\(/i.test(text)) return true
  if (/\b\d+[\s-]\d+\/\d+\b/.test(text)) return true
  if (/\(\d+\/\d+\)/.test(text)) return true
  if (/-?\d+\s*\/\s*\(/.test(text)) return true
  if (/\b\d{1,4}\/\d{1,4}\b/.test(text)) return true
  if (/\b[A-Za-z0-9]\^\d/.test(text)) return true
  if (/[¹²³⁰⁴⁵⁶⁷⁸⁹]/.test(text)) return true
  return false
}
