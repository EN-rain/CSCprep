import katex from 'katex'
import fs from 'fs'

function texFrac(num, den, whole) {
  const core = '\\frac{' + num + '}{' + den + '}'
  return whole ? '$' + whole + core + '$' : '$' + core + '$'
}
function texParenFrac(num, den) {
  return '$(' + '\\frac{' + num + '}{' + den + '}' + ')$'
}
function texSqrt(arg, coef) {
  const core = '\\sqrt{' + arg + '}'
  return coef ? '$' + coef + core + '$' : '$' + core + '$'
}
function texPow(base, exp) {
  return '$' + base + '^{' + exp + '}$'
}
function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)\b(\d+)[\u00a0\s-](\d+)\/(\d+)\b(?!\$)/g, (_m, w, n, d) => texFrac(n, d, w))
  out = out.replace(/(?<!\$)\((\d{1,4})\/(\d{1,4})\)(?!\$)/g, (_m, n, d) => texParenFrac(n, d))
  out = out.replace(/(?<!\$)\b(\d{1,4})\/(\d{1,4})\b(?!\$)/g, (m, n, d) => {
    if (n.length === 4 && d.length === 4) return m
    return texFrac(n, d)
  })
  out = out.replace(/(?<!\$)(\d+)\s*[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, c, a) => texSqrt(a, c))
  out = out.replace(/(?<!\$)[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, a) => texSqrt(a))
  out = out.replace(/(?<!\$)\b([A-Za-z]|\d+)\^(\d+)/g, (_m, b, e) => texPow(b, e))
  return out
}
function renderLine(text) {
  const prepared = inject(text)
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g
  let last = 0
  let match
  let html = ''
  while ((match = re.exec(prepared))) {
    html += prepared.slice(last, match.index).replace(/&/g, '&').replace(/</g, '<')
    const tex = (match[1] ?? match[2] ?? '').trim()
    try {
      html += katex.renderToString(tex, { throwOnError: true, displayMode: false })
    } catch (e) {
      html += '<span style="color:#f66">FAIL: ' + tex + ' :: ' + e.message + '</span>'
    }
    last = match.index + match[0].length
  }
  html += prepared.slice(last).replace(/&/g, '&').replace(/</g, '<')
  return { prepared, html }
}

const samples = [
  'Find the value of x: x = (3/8)(72) + (5/7)(35)',
  'If the weight increases 3 1/8 times when fully loaded',
  '√0.000225 = ____?',
  '5√6 - 3√6 = 2√6',
  '10^3 and x^2',
  'Reduce 231/1001 to lowest terms',
  'Year range should stay plain: 1990/1999',
]

const css = fs.readFileSync('node_modules/katex/dist/katex.min.css', 'utf8')
let body = ''
const report = []
for (const s of samples) {
  const { prepared, html } = renderLine(s)
  const ok = !html.includes('FAIL:')
  report.push({ s, prepared, ok })
  body += '<div class="card">'
  body += '<div class="label">BEFORE</div><code>' + s.replace(/&/g, '&') + '</code>'
  body += '<div class="label">AFTER inject</div><code>' + prepared.replace(/&/g, '&').replace(/</g, '<') + '</code>'
  body += '<div class="label">RENDERED</div><div class="render">' + html + '</div>'
  body += '<div class="status">' + (ok ? 'PASS' : 'FAIL') + '</div>'
  body += '</div>'
}

const page = '<!doctype html><html><head><meta charset="utf-8"/><style>' + css +
  'body{font-family:system-ui,sans-serif;background:#0e1416;color:#eef3f4;padding:24px}' +
  '.card{background:#161d20;border:1px solid #2a353a;border-radius:12px;padding:16px;margin:0 0 16px}' +
  '.label{font-size:11px;letter-spacing:.08em;color:#9aabb2;margin:8px 0 4px;text-transform:uppercase}' +
  'code{display:block;white-space:pre-wrap;color:#9aabb2;font-size:13px}' +
  '.render{font-size:22px;line-height:2;padding:10px 0}' +
  '.katex{color:#eef3f4}' +
  '.status{font-size:12px;font-weight:700;color:#7dcca0}' +
  'h1{font-size:18px;font-weight:600}</style></head><body>' +
  '<h1>MathText visual verification</h1>' + body + '</body></html>'

fs.mkdirSync('artifacts', { recursive: true })
fs.writeFileSync('artifacts/math-verify.html', page)
fs.writeFileSync('artifacts/math-verify.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
