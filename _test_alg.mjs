import katex from 'katex'
import fs from 'fs'

const BS = String.fromCharCode(92)

function texFrac(num, den, whole) {
  const core = BS + 'frac{' + num + '}{' + den + '}'
  return whole ? '$' + whole + core + '$' : '$' + core + '$'
}

function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)(-?\d+)\s*\/\s*\(([^)]+)\)/g, (_m, num, den) =>
    texFrac(num, den.replace(/\s+/g, '')),
  )
  out = out.replace(/(?<!\$)(-?)\b(\d{1,4})\/(\d{1,4})\b(?!\$)/g, (m, sign, num, den) => {
    if (num.length === 4 && den.length === 4) return m
    return texFrac(sign ? sign + num : num, den)
  })
  out = out.replace(/(?<!\$)[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, a) => '$' + BS + 'sqrt{' + a + '}$')
  return out
}

function renderLine(text) {
  const prepared = inject(text)
  const re = /\$([^$]+)\$/g
  let last = 0
  let match
  let html = ''
  let ok = true
  while ((match = re.exec(prepared))) {
    html += prepared.slice(last, match.index)
    const tex = match[1].trim()
    try {
      html += katex.renderToString(tex, { throwOnError: true })
    } catch (e) {
      ok = false
      html += '<span style="color:red">FAIL ' + tex + '</span>'
    }
    last = match.index + match[0].length
  }
  html += prepared.slice(last)
  return { prepared, html, ok }
}

const samples = [
  'If -6/(a - 3) = 3/(a + 2), then a =?',
  '-1/3',
  '1/2',
  '√0.00000081 = ____?',
]

const css = fs.readFileSync('node_modules/katex/dist/katex.min.css', 'utf8')
let body = ''
for (const s of samples) {
  const { prepared, html, ok } = renderLine(s)
  console.log(ok ? 'PASS' : 'FAIL', prepared)
  body += '<div class="card" style="margin:16px 0;padding:16px;background:#161d20;border-radius:12px">'
  body += '<div style="color:#9aabb2;font-size:12px">BEFORE: ' + s + '</div>'
  body += '<div style="color:#9aabb2;font-size:12px">INJECT: ' + prepared.replace(/</g,'<') + '</div>'
  body += '<div style="font-size:22px;line-height:2;margin-top:8px;color:#eef3f4">' + html + '</div>'
  body += '<div style="color:#7dcca0">' + (ok ? 'PASS' : 'FAIL') + '</div></div>'
}

const page = '<!doctype html><html><head><meta charset="utf-8"/><style>' + css +
  'body{font-family:system-ui;background:#0e1416;color:#eef3f4;padding:24px}.katex{color:#eef3f4}</style></head><body>' +
  '<h1>Algebraic / sqrt check</h1>' + body + '</body></html>'

fs.writeFileSync('artifacts/alg-verify.html', page)
