import katex from 'katex'

function texFrac(num, den, whole) {
  const core = '\\frac{' + num + '}{' + den + '}'
  return whole ? '$' + whole + core + '$' : '$' + core + '$'
}

function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)\b(\d+)[\u00a0\s-](\d+)\/(\d+)\b(?!\$)/g, (_m, w, n, d) => texFrac(n, d, w))
  out = out.replace(/(?<!\$)(-?\d+)\s*\/\s*\(([^)]+)\)/g, (_m, num, den) => texFrac(num, den.replace(/\s+/g, '')))
  out = out.replace(/(?<!\$)\((\d{1,4})\/(\d{1,4})\)(?!\$)/g, (_m, n, d) => '$(' + '\\frac{' + n + '}{' + d + '})$')
  out = out.replace(/(?<!\$)(-?)\b(\d{1,4})\/(\d{1,4})\b(?!\$)/g, (m, sign, num, den) => {
    if (den === '0') return m
    if (num.length === 4 && den.length === 4) return m
    return texFrac(sign ? sign + num : num, den)
  })
  return out
}

function render(text) {
  const prepared = inject(text)
  const re = /\$([^$]+)\$/g
  let last = 0
  let match
  let ok = true
  const parts = []
  while ((match = re.exec(prepared))) {
    parts.push(prepared.slice(last, match.index))
    const tex = match[1].trim()
    try {
      katex.renderToString(tex, { throwOnError: true })
      parts.push('[OK:' + tex + ']')
    } catch (e) {
      ok = false
      parts.push('[FAIL:' + tex + ']')
    }
    last = match.index + match[0].length
  }
  parts.push(prepared.slice(last))
  return { prepared, ok, shown: parts.join('') }
}

for (const s of [
  'If -6/(a - 3) = 3/(a + 2), then a =?',
  '-1/3',
  '1/2',
  '1/3',
  '-3',
  '3',
]) {
  const r = render(s)
  console.log((r.ok ? 'PASS' : 'FAIL'), s, '=>', r.prepared)
}
