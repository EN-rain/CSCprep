import katex from 'katex'

const tex = String.fromCharCode(92) + 'frac{1}{2}+' + String.fromCharCode(92) + 'sqrt{0.81}'
const h = katex.renderToString(tex, { throwOnError: true, output: 'html' })
console.log('style= count', (h.match(/style=/g) || []).length)
console.log('has style attr sample', h.includes('style="') || h.includes("style='"))
// show if any
const styles = [...h.matchAll(/style="([^"]*)"/g)].map(m => m[1]).slice(0, 5)
console.log('styles', styles)
