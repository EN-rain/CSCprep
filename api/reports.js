const REPORTS_KEY = 'cscprep:question-reports:v1'
const MAX_REPORTS = 200
const REPORT_RATE_LIMIT = 20
const ALLOWED_SUBJECTS = new Set([
  'Verbal Reasoning',
  'Analytical Ability',
  'Numerical Reasoning',
  'General Information',
  'Filipino',
])
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function getRedisConfig(access = 'write') {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const readOnlyToken = process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN
  const writeToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  const token = access === 'read' ? readOnlyToken || writeToken : writeToken

  return { token, url }
}

async function redisCommand(command, access = 'write') {
  const { token, url } = getRedisConfig(access)

  if (!url || !token) {
    const error = new Error('Redis is not configured.')
    error.statusCode = 503
    throw error
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload.error) {
    const error = new Error(payload.error || 'Redis command failed.')
    error.statusCode = response.status || 500
    throw error
  }

  return payload.result
}

function isReport(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id.length <= 80 &&
    /^[a-z0-9-]+$/i.test(value.id) &&
    typeof value.questionId === 'string' &&
    value.questionId.length <= 80 &&
    /^[a-z0-9-]+$/i.test(value.questionId) &&
    typeof value.itemNumber === 'number' &&
    Number.isInteger(value.itemNumber) &&
    value.itemNumber >= 1 &&
    value.itemNumber <= 1000 &&
    typeof value.subject === 'string' &&
    ALLOWED_SUBJECTS.has(value.subject) &&
    typeof value.prompt === 'string' &&
    value.prompt.length >= 1 &&
    value.prompt.length <= 5000 &&
    typeof value.reportedAt === 'string' &&
    !Number.isNaN(Date.parse(value.reportedAt))
  )
}

function sanitizeReport(report) {
  return {
    id: report.id.slice(0, 80),
    questionId: report.questionId.slice(0, 80),
    itemNumber: report.itemNumber,
    subject: report.subject,
    prompt: report.prompt.slice(0, 1200),
    reportedAt: new Date(report.reportedAt).toISOString(),
  }
}

function parseBody(body) {
  if (!body || typeof body === 'object') {
    return body
  }

  if (typeof body !== 'string' || body.length > 8000) {
    return null
  }

  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function getClientIp(request) {
  const forwardedFor = request.headers['x-forwarded-for']

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim()
  }

  return request.socket?.remoteAddress || 'unknown'
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin

  if (!origin) {
    return true
  }

  const host = request.headers.host

  if (!host) {
    return false
  }

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function enforceReportRateLimit(request) {
  const minuteBucket = Math.floor(Date.now() / 60000)
  const ipKey = getClientIp(request).replace(/[^a-z0-9:.-]/gi, '_').slice(0, 80)
  const rateKey = `cscprep:question-reports:rate:${ipKey}:${minuteBucket}`
  const count = Number(await redisCommand(['INCR', rateKey]))

  if (count === 1) {
    await redisCommand(['EXPIRE', rateKey, 120])
  }

  if (count > REPORT_RATE_LIMIT) {
    const error = new Error('Too many report requests. Try again in a minute.')
    error.statusCode = 429
    throw error
  }
}

async function readReports() {
  const values = await redisCommand(['LRANGE', REPORTS_KEY, 0, MAX_REPORTS - 1], 'read')

  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((value) => {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    })
    .filter(isReport)
}

async function writeReports(reports) {
  await redisCommand(['DEL', REPORTS_KEY])

  if (reports.length > 0) {
    await redisCommand(['RPUSH', REPORTS_KEY, ...reports.map((report) => JSON.stringify(report))])
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
    response.setHeader(header, value)
  })
  response.end(JSON.stringify(payload))
}

export default async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      sendJson(response, 200, { reports: await readReports() })
      return
    }

    if (!isSameOriginRequest(request)) {
      sendJson(response, 403, { error: 'Cross-origin report writes are not allowed.' })
      return
    }

    await enforceReportRateLimit(request)

    if (request.method === 'POST') {
      if (!String(request.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        sendJson(response, 415, { error: 'Expected JSON request body.' })
        return
      }

      const body = parseBody(request.body)

      if (!isReport(body)) {
        sendJson(response, 400, { error: 'Invalid report.' })
        return
      }

      const report = sanitizeReport(body)
      const existingReports = await readReports()

      if (existingReports.some((existingReport) => existingReport.id === report.id)) {
        sendJson(response, 200, { report })
        return
      }

      await redisCommand(['LPUSH', REPORTS_KEY, JSON.stringify(report)])
      await redisCommand(['LTRIM', REPORTS_KEY, 0, MAX_REPORTS - 1])
      sendJson(response, 201, { report })
      return
    }

    if (request.method === 'DELETE') {
      const reportId = typeof request.query.id === 'string' ? request.query.id : ''

      if (!reportId) {
        await redisCommand(['DEL', REPORTS_KEY])
        sendJson(response, 200, { reports: [] })
        return
      }

      const nextReports = (await readReports()).filter((report) => report.id !== reportId)
      await writeReports(nextReports)
      sendJson(response, 200, { reports: nextReports })
      return
    }

    response.setHeader('Allow', 'GET, POST, DELETE')
    sendJson(response, 405, { error: 'Method not allowed.' })
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || 'Reports API failed.' })
  }
}
