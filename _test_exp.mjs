import katex from 'katex'

function texPow(base, exp) {
  return '$' + base + '^{' + exp + '}$'
}
function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)\(([^()]{1,60})\)\s*\^(\d+)(?!\$)/g, (_m, inner, exp) =>
    '$(' + inner.trim() + ')^{' + exp + '}$',
  )
  out = out.replace(/(?<!\$)([A-Za-z])\^(\d+)(?!\$)/g, (_m, base, exp) => texPow(base, exp))
  out = out.replace(/(?<!\$)\b(\d+(?:\.\d+)?)\^(\d+)(?!\$)/g, (_m, base, exp) => texPow(base, exp))
  const SUP = { '²': '2', '³': '3', '¹': '1', '⁰': '0' }
  out = out.replace(/(?<!\$)([A-Za-z0-9)\]])([¹²³⁰]+)/g, (_m, base, sups) => {
    const digits = [...sups].map((ch) => SUP[ch] ?? '').join('')
    return digits ? texPow(base, digits) : _m
  })
  return out
}

function check(s) {
  const prepared = inject(s)
  const re = /\$([^$]+)\$/g
  let m, ok = true
  while ((m = re.exec(prepared))) {
    try {
      katex.renderToString(m[1], { throwOnError: true })
    } catch (e) {
      ok = false
      console.log('  FAIL', m[1], e.message)
    }
  }
  console.log(ok ? 'PASS' : 'FAIL', '=>', prepared)
}

for (const s of [
  'If (a + b)^2 = 25 and (a - b)^2 = 45, what is the value of a² + b²?',
  'If (a + b)^2 = 25 and (a - b)^2 = 45, what is the value of a^2 + b^2?',
  '(25)^0 - (-2)^4 + (-3^4) - (-8)^2 = ?',
  '-2^2 - (-9)^2 - (-3^2) + 15^0 = ?',
  'area is (2s)^2 = 4s^2',
  '(-7)^2 = 49 while (-7^2) means -(7^2)',
  '√0.00000081 = ____?',
  'If -6/(a - 3) = 3/(a + 2), then a =?',
]) {
  // only apply exp inject for exp tests; for others note separately
  check(s)
}
