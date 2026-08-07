import { chromium } from 'playwright-core'
import path from 'path'
import fs from 'fs'

const htmlPath = path.resolve('artifacts/alg-verify.html')
const outPath = path.resolve('artifacts/alg-verify.png')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const exe = fs.existsSync(chrome) ? chrome : edge

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } })
const uri = 'file:///' + htmlPath.replace(/\\/g, '/')
await page.goto(uri, { waitUntil: 'load', timeout: 15000 })
await page.screenshot({ path: outPath, fullPage: true })
await browser.close()
console.log('saved', outPath, fs.statSync(outPath).size)
