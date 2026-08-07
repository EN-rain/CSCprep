import katex from 'katex'

const BS = String.fromCharCode(92)
function texFrac(num, den, whole) {
  const core = BS + 'frac{' + num + '}{' + den + '}'
  return whole ? '$' + whole + core + '$' : '$' + core + '$'
}
function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)(-?\d+)\s*\/\s*\(([^)]+)\)/g, (_m, num, den) => {
    let d = den.replace(/\s+/g, '')
    d = d.replace(/(-?\d+)\/(\d+)/g, (_i, n, m) => BS + 'frac{' + n + '}{' + m + '}')
    d = d.replace(/(-?\d+)\/([A-Za-z])/g, (_i, n, v) => BS + 'frac{' + n + '}{' + v + '}')
    return texFrac(num, d)
  })
  out = out.replace(/(?<!\$)(-?)\b(\d+)\/([A-Za-z])\b(?!\$)/g, (_m, sign, num, den) =>
    texFrac(sign ? sign + num : num, den),
  )
  out = out.replace(/(?<!\$)(-?)\b(\d{1,4})\/(\d{1,4})(?!\d)(?!\$)/g, (m, sign, num, den) => {
    if (num.length === 4 && den.length === 4) return m
    return texFrac(sign ? sign + num : num, den)
  })
  return out
}

for (const s of [
  'If a = 3, then 2 / (1/7 + 1/a) =?',
  'If -6/(a - 3) = 3/(a + 2), then a =?',
  'Reduce 231/1001 to its lowest terms',
]) {
  const prepared = inject(s)
  console.log('IN :', s)
  console.log('OUT:', prepared)
  console.log('\\f?', prepared.includes('\f'))
  const re = /\$([^$]+)\$/g
  let m
  while ((m = re.exec(prepared))) {
    try {
      katex.renderToString(m[1], { throwOnError: true })
      console.log('  OK', m[1])
    } catch (e) {
      console.log('  FAIL', m[1], e.message)
    }
  }
  console.log('---')
}
