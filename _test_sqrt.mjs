import katex from 'katex'

function texSqrt(arg, coef) {
  const core = '\\sqrt{' + arg + '}'
  return coef ? '$' + coef + core + '$' : '$' + core + '$'
}

function inject(text) {
  let out = text
  out = out.replace(/(?<!\$)(\d+)\s*[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, c, a) => texSqrt(a, c))
  out = out.replace(/(?<!\$)[√∛]\s*(\d+(?:\.\d+)?)/g, (_m, a) => texSqrt(a))
  return out
}

const s = '√0.00000081 = ____?'
const prepared = inject(s)
console.log('prepared JSON', JSON.stringify(prepared))

const re = /\$([^$]+)\$/g
let m
while ((m = re.exec(prepared))) {
  const tex = m[1].trim()
  console.log('tex JSON', JSON.stringify(tex))
  console.log('tex chars', [...tex].map(c => c.charCodeAt(0)))
  try {
    const html = katex.renderToString(tex, { throwOnError: true })
    console.log('html length', html.length)
    console.log('has sqrt', html.includes('sqrt'))
    console.log('snippet', html.slice(0, 200))
  } catch (e) {
    console.log('FAIL', e.message)
  }
}
