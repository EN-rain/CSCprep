import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Lenis from 'lenis'
import {
  SUBJECTS,
  type AnswerMap,
  type ChoiceId,
  type ExamMode,
  type ExamSession,
  type ReviewFilter,
  type ReviewFilterOption,
  type Subject,
} from './types'
import {
  completeExam,
  createExamSessionWithExclusions,
  getAnsweredHistoryCount,
  getLoadedQuestionCount,
  MAX_EXAM_ITEMS,
  RANDOM_EXAM_ITEMS,
  replaceExamQuestion,
  resetQuestionHistory,
} from './utils/exam'
import { questionBank } from './data/questionBank'
import { MathText } from './utils/mathText'

type Screen = 'home' | 'exam' | 'results' | 'history' | 'reports'
type Theme = 'light' | 'dark'
type ScreenTransition = 'idle' | 'content-exit' | 'content-enter'
type ReportSyncStatus = 'idle' | 'syncing' | 'local-only'
const THEME_KEY = 'cscprep-theme'
const EXAM_ATTEMPT_HISTORY_KEY = 'cscprep:exam-attempt-history:v2'
const IN_PROGRESS_EXAM_KEY = 'cscprep:in-progress-exam:v1'
const QUESTION_REPORTS_KEY = 'cscprep:question-reports:v1'
const PENDING_QUESTION_REPORTS_KEY = 'cscprep:pending-question-reports:v1'
const RANDOM_EXAM_ITEM_COUNT_KEY = 'cscprep-random-exam-item-count'
const SUBJECT_EXAM_ITEM_COUNTS_KEY = 'cscprep-subject-exam-item-counts'
const SCREEN_EXIT_MS = 300
const SCREEN_ENTER_MS = 420
const POPUP_FADE_MS = 320
const QUESTION_REPLACE_ANIMATION_MS = 520
const QUESTION_BANK_BY_ID = new Map(questionBank.map((question) => [question.id, question]))
const RESOLVED_QUESTION_REPORT_IDS = new Set([
  'cse2026-023',
  'nr-027',
  'cse2026-642',
  'vr-037',
  'cse2026-167',
  'cse2026-358',
  'fi-149',
  'nr-025',
  'cse2026-590',
  'nr-067',
  'aa-167',
  'nr-176',
  'cse2026-275',
  'cse2026-356',
  'cse2026-124',
  'cse2026-550',
  'nr-206',
  'cse2026-354',
  'cse2026-456',
  'cse2026-420',
])

type ReviewItem = {
  itemId: string
  itemNumber: number
  questionId: string
  subject: Subject
  prompt: string
  image?: string
  choices: ExamSession['questions'][number]['choices']
  selectedChoiceId: ChoiceId
  correctChoiceId: ChoiceId
  explanation?: string
  isCorrect: boolean
  /** When set, this is a follow-up in a passage chain — show refer line instead of full passage/image. */
  passageReferItemNumber?: number
  /** Shared passage text from the chain's first item (used to strip repeated passage from prompt). */
  passageAnchorPrompt?: string
}

type SkippedItem = {
  itemId: string
  itemNumber: number
}

type SkippedItemNotice = {
  items: SkippedItem[]
} | null

type HintTarget = {
  itemNumber: number
  question: ExamSession['questions'][number]['question']
} | null

type SubjectStat = {
  subject: Subject
  total: number
  answered: number
  correct: number
}

type SavedExamAttempt = {
  id: string
  submittedAt: string
  title: string
  mode: ExamMode
  timed: boolean
  examNumber: number
  session: ExamSession
  answers: AnswerMap
  score: number
  totalQuestions: number
  subjectStats: SubjectStat[]
}

type InProgressExamDraft = {
  savedAt: number
  session: ExamSession
  answers: AnswerMap
  remainingSeconds: number
  skippedItemNotice: SkippedItemNotice
  skippedItemQueue: SkippedItem[]
  activeSkippedItemId: string | null
}

type QuestionReport = {
  id: string
  questionId: string
  itemNumber: number
  subject: Subject
  prompt: string
  issueDescription?: string
  reportedAt: string
}

const LINE_BREAK_PROMPT_IDS = new Set([
  'aa-001',
  'aa-002',
  'aa-003',
  'aa-004',
  'aa-005',
  'aa-006',
  'aa-007',
  'aa-008',
  'aa-009',
  'aa-010',
  'aa-011',
  'aa-012',
  'aa-013',
  'aa-014',
  'aa-015',
  'aa-016',
  'aa-017',
  'aa-018',
  'aa-019',
  'aa-020',
  'aa-174',
  'aa-175',
  'aa-176',
  'aa-177',
  'aa-178',
  'aa-179',
  'aa-180',
  'aa-181',
  'aa-182',
  'aa-183',
  'aa-184',
  'aa-185',
  'aa-186',
  'aa-187',
  'aa-188',
  'nr-076',
  'nr-077',
  'nr-078',
  'nr-079',
  'nr-080',
  'nr-081',
  'nr-082',
  'nr-083',
  'nr-084',
  'nr-085',
  'nr-086',
  'nr-087',
  'nr-088',
  'nr-089',
  'nr-090',
  'nr-091',
  'nr-092',
  'nr-093',
  'nr-094',
  'nr-095',
  'vr-221',
  'vr-222',
  'vr-224',
  'vr-225',
  'vr-226',
  'vr-227',
  'vr-228',
  'vr-229',
  'vr-230',
  'fi-161',
  'fi-162',
  'fi-163',
  'fi-164',
  'fi-165',
  'fi-166',
  'fi-167',
  'fi-168',
  'fi-169',
  'fi-170',
])

const PRESERVE_PROMPT_LINE_IDS = new Set([
  'vr-276',
  'vr-277',
  'vr-278',
  'vr-279',
  'vr-280',
  'vr-281',
  'vr-282',
  'vr-300',
  'vr-301',
  'vr-302',
  'vr-303',
  'vr-304',
  'vr-431',
  'cse2026-399',
  'cse2026-400',
  'cse2026-401',
  'cse2026-402',
  'cse2026-420',
  'cse2026-421',
  'cse2026-422',
  'cse2026-423',
  'cse2026-424',
  'csc10-064',
])

/** Verse/poem-like prompts: many short lines should keep hard line breaks. */
function looksLikeVersePrompt(prompt: string): boolean {
  const lines = prompt.split('\n')
  if (lines.length < 6) return false
  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length < 5) return false
  const shortCount = nonEmpty.filter((line) => line.trim().length <= 56).length
  return shortCount / nonEmpty.length >= 0.6
}

const PROMPT_IN_IMAGE_IDS = new Set([
  'nr-002',
  'nr-016',
  'nr-017',
  'nr-031',
])

function readExamAttemptHistory(): SavedExamAttempt[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(EXAM_ATTEMPT_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []

    if (!Array.isArray(parsed)) {
      return []
    }

    const attempts = (parsed as SavedExamAttempt[])
      .filter((attempt) => isExamSession(attempt.session))
      .map((attempt) => ({
        ...attempt,
        session: refreshExamSessionQuestions(attempt.session),
      }))

    window.localStorage.setItem(EXAM_ATTEMPT_HISTORY_KEY, JSON.stringify(attempts))

    return attempts
  } catch {
    return []
  }
}

function writeExamAttemptHistory(attempts: SavedExamAttempt[]): void {
  window.localStorage.setItem(EXAM_ATTEMPT_HISTORY_KEY, JSON.stringify(attempts))
}

function clearExamAttemptHistory(): void {
  window.localStorage.removeItem(EXAM_ATTEMPT_HISTORY_KEY)
}

function isChoiceId(value: unknown): value is ChoiceId {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E'
}

function isAnswerMap(value: unknown): value is AnswerMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every(isChoiceId)
}

function isSkippedItem(value: unknown): value is SkippedItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Partial<SkippedItem>
  return typeof item.itemId === 'string' && typeof item.itemNumber === 'number'
}

function isSkippedItemNotice(value: unknown): value is SkippedItemNotice {
  if (value === null) {
    return true
  }

  if (!value || typeof value !== 'object') {
    return false
  }

  const notice = value as Partial<{ items: unknown }>
  return Array.isArray(notice.items) && notice.items.every(isSkippedItem)
}

function isExamSession(value: unknown): value is ExamSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const session = value as Partial<ExamSession>
  return (
    typeof session.examNumber === 'number' &&
    typeof session.title === 'string' &&
    typeof session.timed === 'boolean' &&
    Boolean(session.mode) &&
    Array.isArray(session.questions)
  )
}

function refreshExamSessionQuestions(session: ExamSession): ExamSession {
  return {
    ...session,
    questions: session.questions.map((examQuestion) => {
      const currentQuestion = QUESTION_BANK_BY_ID.get(examQuestion.question.id)

      if (!currentQuestion) {
        return examQuestion
      }

      const currentChoicesById = new Map(currentQuestion.choices.map((choice) => [choice.id, choice]))
      const refreshedChoices = examQuestion.choices
        .map((choice) => currentChoicesById.get(choice.id))
        .filter((choice): choice is ExamSession['questions'][number]['choices'][number] => Boolean(choice))

      currentQuestion.choices.forEach((choice) => {
        if (!refreshedChoices.some((refreshedChoice) => refreshedChoice.id === choice.id)) {
          refreshedChoices.push(choice)
        }
      })

      return {
        ...examQuestion,
        question: currentQuestion,
        choices: refreshedChoices,
      }
    }),
  }
}

function normalizeInProgressExamDraft(draft: InProgressExamDraft): InProgressExamDraft {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - draft.savedAt) / 1000))
  const session = refreshExamSessionQuestions(draft.session)

  if (!draft.session.timed) {
    return {
      ...draft,
      session,
    }
  }

  return {
    ...draft,
    session,
    remainingSeconds: Math.max(0, draft.remainingSeconds - elapsedSeconds),
  }
}

function readInProgressExamDraft(): InProgressExamDraft | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(IN_PROGRESS_EXAM_KEY)
    const parsed = raw ? JSON.parse(raw) : null

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const draft = parsed as Partial<InProgressExamDraft>
    if (
      typeof draft.savedAt !== 'number' ||
      !isExamSession(draft.session) ||
      !isAnswerMap(draft.answers) ||
      typeof draft.remainingSeconds !== 'number' ||
      !isSkippedItemNotice(draft.skippedItemNotice) ||
      !Array.isArray(draft.skippedItemQueue) ||
      !draft.skippedItemQueue.every(isSkippedItem) ||
      (draft.activeSkippedItemId !== null && typeof draft.activeSkippedItemId !== 'string')
    ) {
      return null
    }

    return normalizeInProgressExamDraft({
      savedAt: draft.savedAt,
      session: draft.session,
      answers: draft.answers,
      remainingSeconds: draft.remainingSeconds,
      skippedItemNotice: draft.skippedItemNotice,
      skippedItemQueue: draft.skippedItemQueue,
      activeSkippedItemId: draft.activeSkippedItemId,
    })
  } catch {
    return null
  }
}

function writeInProgressExamDraft(draft: Omit<InProgressExamDraft, 'savedAt'>): void {
  try {
    window.localStorage.setItem(IN_PROGRESS_EXAM_KEY, JSON.stringify({
      ...draft,
      savedAt: Date.now(),
    }))
  } catch {
    // If storage is unavailable or full, keep the in-memory exam running.
  }
}

function clearInProgressExamDraft(): void {
  try {
    window.localStorage.removeItem(IN_PROGRESS_EXAM_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

function readStoredQuestionReports(key: string): QuestionReport[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((report): report is QuestionReport => {
      if (!report || typeof report !== 'object') {
        return false
      }

      const candidate = report as Partial<QuestionReport>
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.questionId === 'string' &&
        typeof candidate.itemNumber === 'number' &&
        typeof candidate.subject === 'string' &&
        typeof candidate.prompt === 'string' &&
        (candidate.issueDescription === undefined || typeof candidate.issueDescription === 'string') &&
        typeof candidate.reportedAt === 'string'
      )
    })
  } catch {
    return []
  }
}

function readQuestionReports(): QuestionReport[] {
  return readStoredQuestionReports(QUESTION_REPORTS_KEY)
}

function readPendingQuestionReports(): QuestionReport[] {
  return readStoredQuestionReports(PENDING_QUESTION_REPORTS_KEY)
}

function writeQuestionReports(reports: QuestionReport[]): void {
  window.localStorage.setItem(QUESTION_REPORTS_KEY, JSON.stringify(reports))
}

function writePendingQuestionReports(reports: QuestionReport[]): void {
  window.localStorage.setItem(PENDING_QUESTION_REPORTS_KEY, JSON.stringify(reports))
}

function mergeQuestionReports(...reportGroups: QuestionReport[][]): QuestionReport[] {
  const reportsById = new Map<string, QuestionReport>()

  reportGroups.flat().forEach((report) => {
    if (RESOLVED_QUESTION_REPORT_IDS.has(report.questionId)) {
      return
    }

    if (!reportsById.has(report.id)) {
      reportsById.set(report.id, report)
    }
  })

  return [...reportsById.values()]
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt))
    .slice(0, 200)
}

function getReportedQuestionIds(reports: QuestionReport[] = readQuestionReports()): Set<string> {
  const reportedKeys = new Set(
    reports.map((report) => {
      const question = QUESTION_BANK_BY_ID.get(report.questionId)
      return normalizeQuestionKey(question?.prompt ?? report.prompt)
    }),
  )

  return new Set(
    questionBank
      .filter((question) => reportedKeys.has(normalizeQuestionKey(question.prompt)))
      .map((question) => question.id),
  )
}

function normalizeQuestionKey(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isQuestionReport(value: unknown): value is QuestionReport {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<QuestionReport>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.questionId === 'string' &&
    typeof candidate.itemNumber === 'number' &&
    typeof candidate.subject === 'string' &&
    typeof candidate.prompt === 'string' &&
    (candidate.issueDescription === undefined || typeof candidate.issueDescription === 'string') &&
    typeof candidate.reportedAt === 'string'
  )
}

async function fetchSharedQuestionReports(): Promise<QuestionReport[]> {
  const response = await fetch('/api/reports', {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Reports API is unavailable.')
  }

  const payload: unknown = await response.json()
  const reports = (payload as { reports?: unknown }).reports

  if (!Array.isArray(reports)) {
    return []
  }

  return reports.filter(isQuestionReport)
}

async function createSharedQuestionReport(report: QuestionReport): Promise<void> {
  const response = await fetch('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(report),
  })

  if (!response.ok) {
    throw new Error('Report was saved locally only.')
  }
}

async function syncPendingQuestionReports(): Promise<QuestionReport[]> {
  const pendingReports = readPendingQuestionReports()

  if (pendingReports.length === 0) {
    return []
  }

  const unsyncedReports: QuestionReport[] = []

  for (const report of pendingReports) {
    try {
      await createSharedQuestionReport(report)
    } catch {
      unsyncedReports.push(report)
    }
  }

  writePendingQuestionReports(unsyncedReports)

  if (unsyncedReports.length > 0) {
    throw new Error('Some reports are still local only.')
  }

  return pendingReports
}

async function deleteSharedQuestionReport(reportId: string): Promise<QuestionReport[]> {
  const response = await fetch(`/api/reports?id=${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Report was deleted locally only.')
  }

  const payload: unknown = await response.json()
  const reports = (payload as { reports?: unknown }).reports

  return Array.isArray(reports) ? reports.filter(isQuestionReport) : []
}

async function clearSharedQuestionReports(): Promise<void> {
  const response = await fetch('/api/reports', {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Reports were cleared locally only.')
  }
}

function getOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function createSavedExamAttempt(session: ExamSession, answers: AnswerMap): SavedExamAttempt {
  const subjectStats = SUBJECTS.map<SubjectStat>((subject) => {
    const subjectQuestions = session.questions.filter(({ question }) => question.subject === subject)
    const answered = subjectQuestions.filter(({ id }) => Boolean(answers[id]))
    const correct = answered.filter(({ id, question }) => answers[id] === question.correctChoiceId)

    return {
      subject,
      total: subjectQuestions.length,
      answered: answered.length,
      correct: correct.length,
    }
  })

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    submittedAt: new Date().toISOString(),
    title: session.title,
    mode: session.mode,
    timed: session.timed,
    examNumber: session.examNumber,
    session,
    answers,
    score: subjectStats.reduce((total, stat) => total + stat.correct, 0),
    totalQuestions: session.questions.length,
    subjectStats,
  }
}

function App() {
  const [initialExamDraft] = useState<InProgressExamDraft | null>(() => readInProgressExamDraft())
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    const savedTheme = window.localStorage.getItem(THEME_KEY)
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [screen, setScreen] = useState<Screen>(() => (initialExamDraft ? 'exam' : 'home'))
  const [session, setSession] = useState<ExamSession | null>(() => initialExamDraft?.session ?? null)
  const [answers, setAnswers] = useState<AnswerMap>(() => initialExamDraft?.answers ?? {})
  const answersRef = useRef<AnswerMap>(answers)
  const [submittedAnswers, setSubmittedAnswers] = useState<AnswerMap>({})
  const [filter, setFilter] = useState<ReviewFilter>([])
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [customTimerMinutes, setCustomTimerMinutes] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('cscprep-custom-timer')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed > 0) {
          return parsed
        }
      }
    }
    return 60
  })
  const [remainingSeconds, setRemainingSeconds] = useState(() => initialExamDraft?.remainingSeconds ?? (customTimerMinutes * 60))
  const [answeredHistoryCount, setAnsweredHistoryCount] = useState(() => getAnsweredHistoryCount())
  const [loadedQuestionCount] = useState(() => getLoadedQuestionCount())
  const [savedAttempts, setSavedAttempts] = useState<SavedExamAttempt[]>(() => readExamAttemptHistory())
  const [questionReports, setQuestionReports] = useState<QuestionReport[]>(() => readQuestionReports())
  const [reportSyncStatus, setReportSyncStatus] = useState<ReportSyncStatus>('idle')
  const [replacingQuestionItemId, setReplacingQuestionItemId] = useState<string | null>(null)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [skippedItemNotice, setSkippedItemNotice] = useState<SkippedItemNotice>(() => initialExamDraft?.skippedItemNotice ?? null)
  const [skippedItemQueue, setSkippedItemQueue] = useState<SkippedItem[]>(() => initialExamDraft?.skippedItemQueue ?? [])
  const [activeSkippedItemId, setActiveSkippedItemId] = useState<string | null>(() => initialExamDraft?.activeSkippedItemId ?? null)
  const [exitNoticeOpen, setExitNoticeOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(getOnlineStatus)
  const [offlineSubmitNoticeOpen, setOfflineSubmitNoticeOpen] = useState(false)
  const [screenTransition, setScreenTransition] = useState<ScreenTransition>('idle')
  const [reportsReturnScreen, setReportsReturnScreen] = useState<Screen>('home')
  const transitionTimeoutRef = useRef<number | null>(null)
  const replacingQuestionTimeoutRef = useRef<number | null>(null)

  const totalQuestions = session?.questions.length ?? 0
  const answeredCount = Object.keys(answers).length
  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (!session) {
      return []
    }

    const passageAnchorById = new Map<string, { itemNumber: number; prompt: string }>()
    for (const examQuestion of session.questions) {
      const passageId = examQuestion.question.passageId
      if (passageId && !passageAnchorById.has(passageId)) {
        passageAnchorById.set(passageId, {
          itemNumber: examQuestion.itemNumber,
          prompt: examQuestion.question.prompt,
        })
      }
    }

    return session.questions.flatMap(({ id, itemNumber, question, choices }) => {
        const selectedChoiceId = submittedAnswers[id]

        if (!selectedChoiceId) {
          return []
        }

        const anchor = question.passageId ? passageAnchorById.get(question.passageId) : undefined
        const isPassageFollowUp = Boolean(anchor && anchor.itemNumber !== itemNumber)

        return [{
          itemId: id,
          itemNumber,
          questionId: question.id,
          subject: question.subject,
          prompt: question.prompt,
          image: question.image,
          choices,
          selectedChoiceId,
          correctChoiceId: question.correctChoiceId,
          explanation: question.explanation,
          isCorrect: selectedChoiceId === question.correctChoiceId,
          passageReferItemNumber: isPassageFollowUp ? anchor!.itemNumber : undefined,
          passageAnchorPrompt: isPassageFollowUp ? anchor!.prompt : undefined,
        }]
      })
  }, [session, submittedAnswers])

  const score = reviewItems.filter((item) => item.isCorrect).length
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0
  const passed = percentage >= 80
  const filteredReviewItems = useMemo(() => reviewItems.filter((item) => {
    if (filter.length === 0) {
      return true
    }

    for (const option of filter) {
      if (option === 'correct' && !item.isCorrect) {
        return false
      }

      if (option === 'wrong' && item.isCorrect) {
        return false
      }

      if ((option === 'Verbal Reasoning' || option === 'Numerical Reasoning' || option === 'Analytical Ability' || option === 'Filipino' || option === 'General Information') && item.subject !== option) {
        return false
      }
    }

    return true
  }), [reviewItems, filter])
  const nextSkippedItem = useMemo(() => {
    if (!activeSkippedItemId || !answers[activeSkippedItemId]) {
      return null
    }

    const activeSkippedItem = skippedItemQueue.find((item) => item.itemId === activeSkippedItemId)

    if (!activeSkippedItem) {
      return null
    }

    const nextItem = skippedItemQueue.find((item) => item.itemId !== activeSkippedItemId && !answers[item.itemId]) ?? null

    if (!nextItem || Math.abs(nextItem.itemNumber - activeSkippedItem.itemNumber) < 4) {
      return null
    }

    return nextItem
  }, [activeSkippedItemId, answers, skippedItemQueue])

  function startExam(mode: ExamMode = { kind: 'mixed' }) {
    if (screenTransition !== 'idle') {
      return
    }

    clearInProgressExamDraft()
    const nextSession = createExamSessionWithExclusions(mode, timerEnabled, getReportedQuestionIds())
    const openExam = () => {
      setSession(nextSession)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter([])
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setRemainingSeconds(customTimerMinutes * 60)
      setScreen('exam')
    }

    transitionToScreen(openExam)
  }

  function chooseAnswer(questionId: string, choiceId: ChoiceId) {
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: choiceId,
    }

    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
  }

  function submitExam() {
    if (!session) {
      return
    }

    if (!isOnline) {
      setOfflineSubmitNoticeOpen(true)
      return
    }

    const latestAnswers = answersRef.current
    const skippedQuestions = session.questions
      .filter(({ id }) => !latestAnswers[id])
      .map(({ id, itemNumber }) => ({
        itemId: id,
        itemNumber,
      }))

    if (skippedQuestions.length > 0) {
      setSkippedItemNotice({ items: skippedQuestions })
      setSkippedItemQueue(skippedQuestions)
      setActiveSkippedItemId(null)
      return
    }

    setSkippedItemQueue([])
    setActiveSkippedItemId(null)
    finishSubmitExam()
  }

  function finishSubmitExam() {
    if (!session) {
      return
    }

    if (!isOnline) {
      setOfflineSubmitNoticeOpen(true)
      return
    }

    finishExamWithAnswers(answersRef.current)
  }

  function finishExamWithAnswers(finalAnswers: AnswerMap) {
    if (!session) {
      return
    }

    if (!isOnline) {
      setOfflineSubmitNoticeOpen(true)
      return
    }

    transitionToScreen(() => {
      clearInProgressExamDraft()
      completeExam(session, finalAnswers)
      const savedAttempt = createSavedExamAttempt(session, finalAnswers)
      const nextSavedAttempts = [savedAttempt, ...readExamAttemptHistory()].slice(0, 50)
      writeExamAttemptHistory(nextSavedAttempts)
      setSavedAttempts(nextSavedAttempts)
      setSubmittedAnswers(finalAnswers)
      setAnsweredHistoryCount(getAnsweredHistoryCount())
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setScreen('results')
    })
  }

  function scrollToExamItem(itemId: string) {
    window.setTimeout(() => {
      const el = document.getElementById(`exam-item-${itemId}`)
      if (!el) {
        return
      }
      if (lenisRef.current) {
        lenisRef.current.scrollTo(el, { offset: -80, duration: 1.0 })
        return
      }
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
  }

  function goToSkippedItem(itemId: string) {
    setSkippedItemNotice(null)
    setActiveSkippedItemId(itemId)
    scrollToExamItem(itemId)
  }

  function goToNextSkippedItem() {
    if (!nextSkippedItem) {
      return
    }

    setActiveSkippedItemId(nextSkippedItem.itemId)
    scrollToExamItem(nextSkippedItem.itemId)
  }

  function goHome() {
    transitionToScreen(() => {
      clearInProgressExamDraft()
      setSession(null)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter([])
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('home')
    })
  }

  function openHistory() {
    transitionToScreen(() => {
      clearInProgressExamDraft()
      setFilter([])
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('history')
    })
  }

  function openReports() {
    void refreshQuestionReports()
    const returnScreen = screen === 'exam' && session ? 'exam' : screen

    transitionToScreen(() => {
      setFilter([])
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setReportsReturnScreen(returnScreen)
      setScreen('reports')
    })
  }

  function closeReports() {
    if (reportsReturnScreen === 'exam' && session) {
      transitionToScreen(() => {
        setFilter([])
        setSkippedItemNotice(null)
        setExitNoticeOpen(false)
        setOfflineSubmitNoticeOpen(false)
        setExpandedImage(null)
        setScreen('exam')
      })
      return
    }

    goHome()
  }

  async function refreshQuestionReports() {
    setReportSyncStatus('syncing')

    try {
      await syncPendingQuestionReports()
      const sharedReports = await fetchSharedQuestionReports()
      const reports = mergeQuestionReports(sharedReports)
      writeQuestionReports(reports)
      setQuestionReports(reports)
      setReportSyncStatus('idle')
    } catch {
      const reports = mergeQuestionReports(readQuestionReports(), readPendingQuestionReports())
      writeQuestionReports(reports)
      setQuestionReports(reports)
      setReportSyncStatus('local-only')
    }
  }

  function reportQuestion(itemId: string, issueDescription: string) {
    if (!session) {
      return
    }

    const examQuestion = session.questions.find((item) => item.id === itemId)

    if (!examQuestion) {
      return
    }

    const report: QuestionReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      questionId: examQuestion.question.id,
      itemNumber: examQuestion.itemNumber,
      subject: examQuestion.question.subject,
      prompt: createReportPrompt(examQuestion.question.prompt),
      issueDescription: issueDescription.trim() || undefined,
      reportedAt: new Date().toISOString(),
    }

    setQuestionReports((currentReports) => {
      const nextReports = [report, ...currentReports].slice(0, 200)
      writeQuestionReports(nextReports)

      return nextReports
    })

    const nextSession = replaceExamQuestion(session, itemId, getReportedQuestionIds([report, ...questionReports]))
    if (nextSession !== session) {
      if (replacingQuestionTimeoutRef.current) {
        window.clearTimeout(replacingQuestionTimeoutRef.current)
      }

      setReplacingQuestionItemId(itemId)
      setSession(nextSession)
      replacingQuestionTimeoutRef.current = window.setTimeout(() => {
        setReplacingQuestionItemId((currentItemId) => (currentItemId === itemId ? null : currentItemId))
        replacingQuestionTimeoutRef.current = null
      }, QUESTION_REPLACE_ANIMATION_MS)
    }

    if (answersRef.current[itemId]) {
      const { [itemId]: _removedAnswer, ...remainingAnswers } = answersRef.current
      answersRef.current = remainingAnswers
      setAnswers(remainingAnswers)
    }

    void createSharedQuestionReport(report)
      .then(() => {
        const pendingReports = readPendingQuestionReports().filter((pendingReport) => pendingReport.id !== report.id)
        writePendingQuestionReports(pendingReports)
        setReportSyncStatus('idle')
      })
      .catch(() => {
        const pendingReports = mergeQuestionReports([report], readPendingQuestionReports())
        writePendingQuestionReports(pendingReports)
        setReportSyncStatus('local-only')
      })
  }

  function deleteQuestionReport(reportId: string) {
    const nextReports = questionReports.filter((report) => report.id !== reportId)
    const nextPendingReports = readPendingQuestionReports().filter((report) => report.id !== reportId)
    writeQuestionReports(nextReports)
    writePendingQuestionReports(nextPendingReports)
    setQuestionReports(nextReports)

    void deleteSharedQuestionReport(reportId)
      .then((sharedReports) => {
        writeQuestionReports(sharedReports)
        setQuestionReports(sharedReports)
        setReportSyncStatus('idle')
      })
      .catch(() => setReportSyncStatus('local-only'))
  }

  function clearQuestionReports() {
    writeQuestionReports([])
    writePendingQuestionReports([])
    setQuestionReports([])

    void clearSharedQuestionReports()
      .then(() => setReportSyncStatus('idle'))
      .catch(() => setReportSyncStatus('local-only'))
  }

  function openSavedAttempt(attempt: SavedExamAttempt) {
    transitionToScreen(() => {
      const refreshedSession = refreshExamSessionQuestions(attempt.session)

      clearInProgressExamDraft()
      setSession(refreshedSession)
      setAnswers(attempt.answers)
      setSubmittedAnswers(attempt.answers)
      setFilter([])
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('results')
    })
  }

  function deleteExamHistory() {
    clearExamAttemptHistory()
    clearInProgressExamDraft()
    resetQuestionHistory()
    setSavedAttempts([])
    setAnsweredHistoryCount(0)
  }

  function deleteSavedAttempt(attemptId: string) {
    const nextSavedAttempts = savedAttempts.filter((attempt) => attempt.id !== attemptId)
    writeExamAttemptHistory(nextSavedAttempts)
    setSavedAttempts(nextSavedAttempts)
  }

  function exitExam() {
    if (!session) {
      return
    }

    setSkippedItemNotice(null)
    setExitNoticeOpen(true)
  }

  function confirmExitExam() {
    if (!session) {
      return
    }

    transitionToScreen(() => {
      clearInProgressExamDraft()
      if (answeredCount > 0) {
        completeExam(session, answers)
        setAnsweredHistoryCount(getAnsweredHistoryCount())
      }

      setSession(null)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter([])
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setScreen('home')
    })
  }

  function toggleTimer() {
    setTimerEnabled((current) => !current)
  }

  function scheduleTransition(callback: () => void, delay: number) {
    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current)
    }

    transitionTimeoutRef.current = window.setTimeout(() => {
      transitionTimeoutRef.current = null
      callback()
    }, delay)
  }

  function transitionToScreen(callback: () => void) {
    if (screenTransition !== 'idle') {
      return
    }

    setScreenTransition('content-exit')
    scheduleTransition(() => {
      callback()
      playScreenEnter()
    }, SCREEN_EXIT_MS)
  }

  function playScreenEnter() {
    setScreenTransition('content-enter')
    scheduleTransition(() => {
      setScreenTransition('idle')
    }, SCREEN_ENTER_MS)
  }

  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  useEffect(() => {
    function updateOnlineStatus() {
      const nextIsOnline = getOnlineStatus()
      setIsOnline(nextIsOnline)

      if (nextIsOnline) {
        setOfflineSubmitNoticeOpen(false)
      }
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    updateOnlineStatus()

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  useEffect(() => {
    setSession((currentSession) => currentSession ? refreshExamSessionQuestions(currentSession) : currentSession)
  }, [])

  useEffect(() => {
    if (screen !== 'exam' || !session?.timed) {
      return
    }

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [screen, session?.timed])

  useEffect(() => {
    if (screen !== 'exam' || !session?.timed || remainingSeconds > 0 || screenTransition !== 'idle') {
      return
    }

    finishExamWithAnswers(answersRef.current)
  }, [remainingSeconds, screen, screenTransition, session?.timed])

  useEffect(() => {
    if (screen !== 'exam' || !session) {
      return
    }

    writeInProgressExamDraft({
      session,
      answers,
      remainingSeconds,
      skippedItemNotice,
      skippedItemQueue,
      activeSkippedItemId,
    })
  }, [activeSkippedItemId, answers, remainingSeconds, screen, session, skippedItemNotice, skippedItemQueue])

  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Native scroll is more reliable on phones/tablets; Lenis often fights touch scrolling.
    const touchQuery = window.matchMedia('(hover: none), (pointer: coarse), (max-width: 900px)')

    let lenis: Lenis | null = null
    let rafId = 0

    const raf = (time: number) => {
      lenis?.raf(time)
      rafId = window.requestAnimationFrame(raf)
    }

    const shouldUseNativeScroll = () => motionQuery.matches || touchQuery.matches

    const startLenis = () => {
      if (lenis || shouldUseNativeScroll()) {
        return
      }

      lenis = new Lenis({
        // Drive the loop ourselves for reliable frame updates.
        autoRaf: false,
        anchors: true,
        smoothWheel: true,
        // Lower lerp = smoother / heavier inertia (0–1).
        lerp: 0.08,
        wheelMultiplier: 0.9,
        touchMultiplier: 1.5,
        syncTouch: false,
      })

      lenisRef.current = lenis
      document.documentElement.classList.add('lenis', 'lenis-smooth')
      rafId = window.requestAnimationFrame(raf)
    }

    const stopLenis = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      if (lenis) {
        lenis.destroy()
        lenis = null
      }
      lenisRef.current = null
      document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-scrolling', 'lenis-stopped')
    }

    const onCapabilityChange = () => {
      stopLenis()
      if (!shouldUseNativeScroll()) {
        startLenis()
      }
    }

    startLenis()
    motionQuery.addEventListener('change', onCapabilityChange)
    touchQuery.addEventListener('change', onCapabilityChange)

    return () => {
      motionQuery.removeEventListener('change', onCapabilityChange)
      touchQuery.removeEventListener('change', onCapabilityChange)
      stopLenis()
    }
  }, [])

  // Keep Lenis dimensions in sync when the active screen changes.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      lenisRef.current?.resize()
    })
    return () => window.cancelAnimationFrame(id)
  }, [screen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cscprep-custom-timer', String(customTimerMinutes))
    }
  }, [customTimerMinutes])

  useEffect(() => {
    if (screen !== 'results') {
      return
    }

    window.requestAnimationFrame(() => {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(0, { immediate: true })
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      }
    })
  }, [screen])

  useEffect(() => () => {
    if (replacingQuestionTimeoutRef.current) {
      window.clearTimeout(replacingQuestionTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    function handleReportsShortcut(event: KeyboardEvent) {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        openReports()
      }
    }

    window.addEventListener('keydown', handleReportsShortcut)
    return () => window.removeEventListener('keydown', handleReportsShortcut)
  })

  useEffect(() => {
    void refreshQuestionReports()
  }, [])

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  function toggleTheme() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }

  return (
    <main className={`app-shell app-shell--${screenTransition}`}>
      {screen === 'home' && (
        <div className="screen-frame screen-frame--home">
          <HomeScreen
            answeredHistoryCount={answeredHistoryCount}
            savedAttemptCount={savedAttempts.length}
            loadedQuestionCount={loadedQuestionCount}
            onToggleTimer={toggleTimer}
            onOpenHistory={openHistory}
            onStartExam={startExam}
            timerEnabled={timerEnabled}
            customTimerMinutes={customTimerMinutes}
            onCustomTimerMinutesChange={setCustomTimerMinutes}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

      {screen === 'exam' && session && (
        <div className="screen-frame screen-frame--exam">
          <ExamScreen
            answeredCount={answeredCount}
            answers={answers}
            exitNoticeOpen={exitNoticeOpen}
            expandedImage={expandedImage}
            isOnline={isOnline}
            onChooseAnswer={chooseAnswer}
            onCloseImage={() => setExpandedImage(null)}
            onCloseOfflineSubmitNotice={() => setOfflineSubmitNoticeOpen(false)}
            onCancelExit={() => setExitNoticeOpen(false)}
            onCloseSkippedItems={() => setSkippedItemNotice(null)}
            onConfirmExit={confirmExitExam}
            onExit={exitExam}
            onGoToNextSkippedItem={goToNextSkippedItem}
            onOpenImage={setExpandedImage}
            onReportQuestion={reportQuestion}
            onGoToSkippedItem={goToSkippedItem}
            onSubmit={submitExam}
            onSubmitAnyway={finishSubmitExam}
            nextSkippedItem={nextSkippedItem}
            offlineSubmitNoticeOpen={offlineSubmitNoticeOpen}
            remainingSeconds={remainingSeconds}
            replacingQuestionItemId={replacingQuestionItemId}
            session={session}
            skippedItemNotice={skippedItemNotice}
            theme={theme}
            totalQuestions={totalQuestions}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

      {screen === 'results' && session && (
        <div className="screen-frame screen-frame--results">
          <ResultsScreen
            examMode={session.mode}
            expandedImage={expandedImage}
            filter={filter}
            filteredReviewItems={filteredReviewItems}
            onToggleFilter={(option) => {
              setFilter((current) => {
                if (current.includes(option)) {
                  return current.filter((o) => o !== option)
                }

                // Correct / wrong are mutually exclusive
                if (option === 'correct' || option === 'wrong') {
                  return [
                    ...current.filter((o) => o !== 'correct' && o !== 'wrong'),
                    option,
                  ]
                }

                // Only one subject filter at a time (avoids empty AND combinations)
                const subjects = [
                  'Verbal Reasoning',
                  'Numerical Reasoning',
                  'Analytical Ability',
                  'Filipino',
                  'General Information',
                ] as const
                if ((subjects as readonly string[]).includes(option)) {
                  return [
                    ...current.filter((o) => !(subjects as readonly string[]).includes(o)),
                    option,
                  ]
                }

                return [...current, option]
              })
            }}
            onCloseImage={() => setExpandedImage(null)}
            onOpenImage={setExpandedImage}
            onRetake={() => startExam(session.mode)}
            onHome={goHome}
            passed={passed}
            percentage={percentage}
            reviewItems={reviewItems}
            score={score}
            theme={theme}
            totalQuestions={totalQuestions}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

      {screen === 'history' && (
        <div className="screen-frame screen-frame--history">
          <HistoryScreen
            attempts={savedAttempts}
            answeredHistoryCount={answeredHistoryCount}
            loadedQuestionCount={loadedQuestionCount}
            onDeleteHistory={deleteExamHistory}
            onDeleteAttempt={deleteSavedAttempt}
            onHome={goHome}
            onOpenAttempt={openSavedAttempt}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

      {screen === 'reports' && (
        <div className="screen-frame screen-frame--reports">
          <ReportsScreen
            expandedImage={expandedImage}
            reports={questionReports}
            returnLabel={reportsReturnScreen === 'exam' && session ? 'Resume exam' : 'Home'}
            syncStatus={reportSyncStatus}
            onCloseImage={() => setExpandedImage(null)}
            onClearReports={clearQuestionReports}
            onDeleteReport={deleteQuestionReport}
            onOpenImage={setExpandedImage}
            onReturn={closeReports}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

    </main>
  )
}

type ThemeToggleProps = {
  theme: Theme
  onToggle: () => void
}

function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const nextTheme = theme === 'light' ? 'dark' : 'light'

  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      className="theme-toggle"
      onClick={onToggle}
      title={`Switch to ${nextTheme} mode`}
      type="button"
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24">
      <path
        d="M15 2.5a8.8 8.8 0 1 0 6.5 15.1A9.8 9.8 0 0 1 15 2.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="currentColor" r="4.25" />
      <path
        d="M12 1.75v3M12 19.25v3M1.75 12h3M19.25 12h3M4.4 4.4l2.1 2.1M17.5 17.5l2.1 2.1M19.6 4.4l-2.1 2.1M6.5 17.5l-2.1 2.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

type HomeScreenProps = {
  answeredHistoryCount: number
  savedAttemptCount: number
  loadedQuestionCount: number
  onOpenHistory: () => void
  onStartExam: (mode?: ExamMode) => void
  onToggleTimer: () => void
  timerEnabled: boolean
  customTimerMinutes: number
  onCustomTimerMinutesChange: (minutes: number) => void
  theme: Theme
  onToggleTheme: () => void
}

function HomeScreen({
  answeredHistoryCount,
  savedAttemptCount,
  loadedQuestionCount,
  onOpenHistory,
  onStartExam,
  onToggleTimer,
  timerEnabled,
  customTimerMinutes,
  onCustomTimerMinutesChange,
  theme,
  onToggleTheme,
}: HomeScreenProps) {
  const [randomExamItemCount, setRandomExamItemCount] = useState(() => {
    if (typeof window === 'undefined') {
      return String(RANDOM_EXAM_ITEMS)
    }

    const saved = window.localStorage.getItem(RANDOM_EXAM_ITEM_COUNT_KEY)
    return saved && /^\d+$/u.test(saved)
      ? String(normalizeRequestedItemCount(saved, RANDOM_EXAM_ITEMS))
      : String(RANDOM_EXAM_ITEMS)
  })
  const [subjectExamItemCounts, setSubjectExamItemCounts] = useState<Record<Subject, string>>(() => {
      const defaultCounts = SUBJECTS.reduce(
        (counts, subject) => ({
          ...counts,
          [subject]: '100',
        }),
        {} as Record<Subject, string>,
      )

      if (typeof window === 'undefined') {
        return defaultCounts
      }

      try {
        const raw = window.localStorage.getItem(SUBJECT_EXAM_ITEM_COUNTS_KEY)
        const parsed = raw ? JSON.parse(raw) as Partial<Record<Subject, string>> : null

        if (!parsed || typeof parsed !== 'object') {
          return defaultCounts
        }

        return SUBJECTS.reduce(
          (counts, subject) => ({
            ...counts,
            [subject]: typeof parsed[subject] === 'string' && /^\d+$/u.test(parsed[subject] as string)
              ? String(normalizeRequestedItemCount(parsed[subject] as string, 100))
              : defaultCounts[subject],
          }),
          {} as Record<Subject, string>,
        )
      } catch {
        return defaultCounts
      }
    })

  useEffect(() => {
    window.localStorage.setItem(RANDOM_EXAM_ITEM_COUNT_KEY, randomExamItemCount)
  }, [randomExamItemCount])

  useEffect(() => {
    window.localStorage.setItem(SUBJECT_EXAM_ITEM_COUNTS_KEY, JSON.stringify(subjectExamItemCounts))
  }, [subjectExamItemCounts])

  return (
    <section className="home">
      <div className="home__content">
        <div>
          <p className="eyebrow">Civil Service Exam Practice</p>
          <h1>CSCprep</h1>
          <p className="tagline">Anonymous drills for the Civil Service Exam—mixed sets or one subject, timed if you want, scored the moment you finish.</p>
        </div>
      </div>

      <section className="start-panel" aria-label="Start an exam">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2>Choose an exam</h2>
            <span className="history-indicator">
              Answered {formatBankProgress(answeredHistoryCount)}/{formatBankProgress(loadedQuestionCount)}
            </span>
          </div>
          <div className="history-tools">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <div className="timer-control-group">
              <button
                aria-pressed={timerEnabled}
                className={timerEnabled ? 'toggle toggle--active' : 'toggle'}
                type="button"
                onClick={onToggleTimer}
              >
                <span className="toggle__label">Timer</span>
                <span className="toggle__state">{timerEnabled ? 'On' : 'Off'}</span>
              </button>
              {timerEnabled && (
                <div className="timer-input-wrapper">
                  <input
                    type="number"
                    min="1"
                    max="480"
                    value={customTimerMinutes || ''}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === '') {
                        onCustomTimerMinutesChange(0)
                        return
                      }
                      const value = parseInt(val, 10)
                      if (!isNaN(value) && value >= 0) {
                        onCustomTimerMinutesChange(value)
                      }
                    }}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value, 10)
                      if (isNaN(value) || value <= 0) {
                        onCustomTimerMinutesChange(60)
                      }
                    }}
                    className="timer-input"
                    aria-label="Timer duration in minutes"
                  />
                  <span className="timer-input-unit">min</span>
                </div>
              )}
            </div>
            <button className="button button--ghost button--compact" type="button" onClick={onOpenHistory}>
              History {savedAttemptCount > 0 ? `(${savedAttemptCount})` : ''}
            </button>
          </div>
        </div>
        <div className="start-grid">
          <div
            className="start-option start-option--configurable"
            onClick={() => onStartExam({ kind: 'mixed', itemCount: normalizeRequestedItemCount(randomExamItemCount, RANDOM_EXAM_ITEMS) })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onStartExam({ kind: 'mixed', itemCount: normalizeRequestedItemCount(randomExamItemCount, RANDOM_EXAM_ITEMS) })
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="start-option__content">
              <strong>Random Exam</strong>
            </div>
            <label className="start-option__field">
              <input
                aria-label="Random exam item count"
                inputMode="numeric"
                max={MAX_EXAM_ITEMS}
                min="1"
                onBlur={() => setRandomExamItemCount(String(normalizeRequestedItemCount(randomExamItemCount, RANDOM_EXAM_ITEMS)))}
                onChange={(event) => setRandomExamItemCount(event.target.value.replace(/\D/gu, ''))}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onStartExam({ kind: 'mixed', itemCount: normalizeRequestedItemCount(randomExamItemCount, RANDOM_EXAM_ITEMS) })
                  }
                }}
                pattern="[0-9]*"
                type="text"
                value={randomExamItemCount}
              />
            </label>
          </div>
          {SUBJECTS.map((subject) => (
            <div
              className="start-option start-option--configurable"
              key={subject}
              onClick={() => onStartExam({
                kind: 'subject',
                subject,
                itemCount: normalizeRequestedItemCount(subjectExamItemCounts[subject], 100),
              })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onStartExam({
                    kind: 'subject',
                    subject,
                    itemCount: normalizeRequestedItemCount(subjectExamItemCounts[subject], 100),
                  })
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="start-option__content">
                <strong>{subject} Exam</strong>
              </div>
              <label className="start-option__field">
                <input
                  aria-label={`${subject} exam item count`}
                  inputMode="numeric"
                  max={MAX_EXAM_ITEMS}
                  min="1"
                  onBlur={() => {
                    setSubjectExamItemCounts((currentCounts) => ({
                      ...currentCounts,
                      [subject]: String(normalizeRequestedItemCount(currentCounts[subject], 100)),
                    }))
                  }}
                  onChange={(event) => {
                    const nextValue = event.target.value.replace(/\D/gu, '')
                    setSubjectExamItemCounts((currentCounts) => ({
                      ...currentCounts,
                      [subject]: nextValue,
                    }))
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onStartExam({
                        kind: 'subject',
                        subject,
                        itemCount: normalizeRequestedItemCount(subjectExamItemCounts[subject], 100),
                      })
                    }
                  }}
                  pattern="[0-9]*"
                  type="text"
                  value={subjectExamItemCounts[subject]}
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

type HistoryScreenProps = {
  attempts: SavedExamAttempt[]
  answeredHistoryCount: number
  loadedQuestionCount: number
  onDeleteHistory: () => void
  onDeleteAttempt: (attemptId: string) => void
  onHome: () => void
  onOpenAttempt: (attempt: SavedExamAttempt) => void
  theme: Theme
  onToggleTheme: () => void
}

function HistoryScreen({
  attempts,
  answeredHistoryCount,
  loadedQuestionCount,
  onDeleteHistory,
  onDeleteAttempt,
  onHome,
  onOpenAttempt,
  theme,
  onToggleTheme,
}: HistoryScreenProps) {
  const [isEditingHistory, setIsEditingHistory] = useState(false)
  const totalSavedItems = attempts.reduce((total, attempt) => total + attempt.totalQuestions, 0)
  const totalCorrect = attempts.reduce((total, attempt) => total + attempt.score, 0)

  return (
    <section className="history">
      <header className="results-hero">
        <div>
          <p className="eyebrow">Local history</p>
          <h1>History</h1>
          <p className="status">
            {attempts.length} submitted {attempts.length === 1 ? 'exam' : 'exams'} saved on this device.
          </p>
        </div>
        <div className="results-hero__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="button button--ghost" onClick={onHome} type="button">
            Home
          </button>
        </div>
      </header>

      <div className="result-stats">
        <div>
          <span>{attempts.length}</span>
          <p>submitted exams</p>
        </div>
        <div>
          <span>{totalSavedItems > 0 ? `${Math.round((totalCorrect / totalSavedItems) * 100)}%` : '0%'}</span>
          <p>overall score</p>
        </div>
        <div>
          <span>{formatBankProgress(loadedQuestionCount)}</span>
          <p>loaded bank</p>
        </div>
      </div>

      <section className="history-panel" aria-label="Submitted exams">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2>Submitted exams</h2>
          </div>
          <div className="history-panel__actions">
            {isEditingHistory && (
              <button
                className="attempt-row__delete"
                disabled={attempts.length === 0 && answeredHistoryCount === 0}
                onClick={() => {
                  onDeleteHistory()
                  setIsEditingHistory(false)
                }}
                type="button"
              >
                Delete all
              </button>
            )}
            <button
              aria-pressed={isEditingHistory}
              className="attempt-row__edit"
              disabled={attempts.length === 0}
              onClick={() => setIsEditingHistory((isEditing) => !isEditing)}
              type="button"
            >
              {isEditingHistory ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>

        {attempts.length === 0 ? (
          <p className="empty-history">No submitted exams saved yet.</p>
        ) : (
          <div className="attempt-list">
            {attempts.map((attempt) => (
              <div className={isEditingHistory ? 'attempt-row attempt-row--editing' : 'attempt-row'} key={attempt.id}>
                <button className="attempt-row__open" onClick={() => onOpenAttempt(attempt)} type="button">
                  <span>
                    <strong>{attempt.title}</strong>
                    <small>{formatAttemptDate(attempt.submittedAt)}</small>
                  </span>
                  <span>
                    <strong>
                      {attempt.score}/{attempt.totalQuestions}
                    </strong>
                    <small>{Math.round((attempt.score / attempt.totalQuestions) * 100)}%</small>
                  </span>
                </button>
                {isEditingHistory && (
                  <div className="attempt-row__actions">
                    <button
                      className="attempt-row__delete"
                      onClick={() => {
                        onDeleteAttempt(attempt.id)
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}

type ReportsScreenProps = {
  expandedImage: string | null
  reports: QuestionReport[]
  returnLabel: string
  syncStatus: ReportSyncStatus
  onCloseImage: () => void
  onClearReports: () => void
  onDeleteReport: (reportId: string) => void
  onOpenImage: (imageSrc: string) => void
  onReturn: () => void
  theme: Theme
  onToggleTheme: () => void
}

function ReportsScreen({
  expandedImage,
  reports,
  returnLabel,
  syncStatus,
  onCloseImage,
  onClearReports,
  onDeleteReport,
  onOpenImage,
  onReturn,
  theme,
  onToggleTheme,
}: ReportsScreenProps) {
  return (
    <section className="reports">
      <header className="results-hero">
        <div>
          <p className="eyebrow">Question reports</p>
          <h1>Reports</h1>
          <p className="status">
            {reports.length} {reports.length === 1 ? 'question' : 'questions'} marked for review.
          </p>
          <p className="report-sync-status">
            {syncStatus === 'syncing' && 'Syncing shared reports...'}
            {syncStatus === 'idle' && 'Shared reports sync is active.'}
            {syncStatus === 'local-only' && 'Shared reports are unavailable; showing this device only.'}
          </p>
        </div>
        <div className="results-hero__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="button button--ghost" onClick={onReturn} type="button">
            {returnLabel}
          </button>
        </div>
      </header>

      <section className="history-panel" aria-label="Reported questions">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2>Reported question IDs</h2>
          </div>
          <div className="history-panel__actions">
            <button
              className="attempt-row__delete"
              disabled={reports.length === 0}
              onClick={onClearReports}
              type="button"
            >
              Clear all
            </button>
          </div>
        </div>

        {reports.length === 0 ? (
          <p className="empty-history">No questions reported yet.</p>
        ) : (
          <div className="report-list">
            {reports.map((report) => {
              const currentQuestion = QUESTION_BANK_BY_ID.get(report.questionId)

              return (
                <article className="report-row" key={report.id}>
                  <div>
                    <div className="report-row__meta">
                      <strong>{report.questionId}</strong>
                      <span>Item {report.itemNumber}</span>
                      <span>{report.subject}</span>
                      <span>{formatAttemptDate(report.reportedAt)}</span>
                    </div>
                    <ReportPrompt prompt={report.prompt} />
                    {currentQuestion && (
                      <ReportQuestionDetails question={currentQuestion} onOpenImage={onOpenImage} />
                    )}
                    {report.issueDescription && (
                      <p className="report-row__issue">{report.issueDescription}</p>
                    )}
                  </div>
                  <button
                    className="attempt-row__delete"
                    onClick={() => onDeleteReport(report.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {expandedImage && <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />}
    </section>
  )
}

type ReportQuestionDetailsProps = {
  question: (typeof questionBank)[number]
  onOpenImage: (imageSrc: string) => void
}

function ReportQuestionDetails({ question, onOpenImage }: ReportQuestionDetailsProps) {
  return (
    <div className="report-question-details">
      {question.image && (
        <button
          className="question-image-button report-question-details__image"
          onClick={() => onOpenImage(question.image!)}
          type="button"
        >
          <img className="question-image" src={question.image} alt={`${question.id} prompt image`} draggable={false} />
          <span className="question-image-hint">Click to enlarge</span>
        </button>
      )}
      <div className="report-choice-list">
        {question.choices.map((choice, index) => (
          <div className="report-choice" key={choice.id}>
            <span className="choice-letter">{String.fromCharCode(97 + index)}</span>
            {choice.image ? (
              <button
                className="choice-image-button"
                onClick={() => onOpenImage(choice.image!)}
                type="button"
              >
                <img className="choice-image" src={choice.image} alt={`${question.id} choice ${choice.id}`} draggable={false} />
              </button>
            ) : (
              <p><MathText text={choice.text} /></p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

type ExamScreenProps = {
  answeredCount: number
  answers: AnswerMap
  exitNoticeOpen: boolean
  expandedImage: string | null
  isOnline: boolean
  onCancelExit: () => void
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onCloseImage: () => void
  onCloseOfflineSubmitNotice: () => void
  onCloseSkippedItems: () => void
  onConfirmExit: () => void
  onExit: () => void
  onGoToNextSkippedItem: () => void
  onGoToSkippedItem: (itemId: string) => void
  onOpenImage: (imageSrc: string) => void
  onReportQuestion: (itemId: string, issueDescription: string) => void
  onSubmit: () => void
  onSubmitAnyway: () => void
  nextSkippedItem: SkippedItem | null
  offlineSubmitNoticeOpen: boolean
  remainingSeconds: number
  replacingQuestionItemId: string | null
  session: ExamSession
  skippedItemNotice: SkippedItemNotice
  theme: Theme
  totalQuestions: number
  onToggleTheme: () => void
}

function ExamScreen({
  answeredCount,
  answers,
  exitNoticeOpen,
  expandedImage,
  isOnline,
  onCancelExit,
  onChooseAnswer,
  onCloseImage,
  onCloseOfflineSubmitNotice,
  onCloseSkippedItems,
  onConfirmExit,
  onExit,
  onGoToNextSkippedItem,
  onGoToSkippedItem,
  onOpenImage,
  onReportQuestion,
  onSubmit,
  onSubmitAnyway,
  nextSkippedItem,
  offlineSubmitNoticeOpen,
  remainingSeconds,
  replacingQuestionItemId,
  session,
  skippedItemNotice,
  theme,
  totalQuestions,
  onToggleTheme,
}: ExamScreenProps) {
  const unansweredCount = totalQuestions - answeredCount
  const passageAnchorById = useMemo(() => {
    const map = new Map<string, { itemNumber: number; prompt: string }>()
    for (const examQuestion of session.questions) {
      const passageId = examQuestion.question.passageId
      if (passageId && !map.has(passageId)) {
        map.set(passageId, {
          itemNumber: examQuestion.itemNumber,
          prompt: examQuestion.question.prompt,
        })
      }
    }
    return map
  }, [session.questions])
  const [hintTarget, setHintTarget] = useState<HintTarget>(null)

  return (
    <section className="exam">
      <header className="exam-header">
        <div className="exam-header__summary">
          <p className="eyebrow">Exam try #{session.examNumber}</p>
          <div className="exam-title-row">
            <h1>{session.title}</h1>
            <p className="exam-meta">
              <strong>
                {answeredCount}/{totalQuestions}
              </strong>
              <span>answered</span>
            </p>
          </div>
        </div>
        <div className="exam-header__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {session.timed && <span className="timer-pill">{formatTimer(remainingSeconds)}</span>}
          <button className="button button--danger" onClick={onExit} type="button">
            Exit Exam
          </button>
          <button
            className="button button--primary"
            disabled={!isOnline}
            onClick={onSubmit}
            title={isOnline ? undefined : 'Connect to the internet to submit this exam.'}
            type="button"
          >
            Submit Exam
          </button>
        </div>
      </header>

      {!isOnline && (
        <div className="connection-banner" role="status">
          You are offline. Answers are saved on this device, and submit will unlock when connection returns.
        </div>
      )}

      {offlineSubmitNoticeOpen && (
        <div className="connection-banner connection-banner--alert" role="alert">
          Connect to the internet before submitting this exam.
          <button onClick={onCloseOfflineSubmitNotice} type="button">
            Dismiss
          </button>
        </div>
      )}

      <div className="question-list">
        {session.questions.map(({ id, itemNumber, question, choices }) => {
          const anchor = question.passageId ? passageAnchorById.get(question.passageId) : undefined
          const isPassageFollowUp = Boolean(anchor && anchor.itemNumber !== itemNumber)

          return (
            <QuestionCard
              answers={answers}
              itemId={id}
              itemNumber={itemNumber}
              isReplacing={replacingQuestionItemId === id}
              key={id}
              image={question.image}
              onChooseAnswer={onChooseAnswer}
              onOpenHint={() => setHintTarget({ itemNumber, question })}
              onOpenImage={onOpenImage}
              onReportQuestion={onReportQuestion}
              passageAnchorPrompt={isPassageFollowUp ? anchor!.prompt : undefined}
              passageReferItemNumber={isPassageFollowUp ? anchor!.itemNumber : undefined}
              question={question}
              choices={choices}
            />
          )
        })}
      </div>

      {unansweredCount > 0 && <p className="exam-footer-note">{unansweredCount} items left unanswered.</p>}

      {nextSkippedItem && (
        <div className="next-skipped-action">
          <button className="button button--primary" onClick={onGoToNextSkippedItem} type="button">
            Go to next item
          </button>
        </div>
      )}

      {skippedItemNotice && (
        <SkippedItemPanel
          canSubmit={isOnline}
          items={skippedItemNotice.items}
          onDismiss={onCloseSkippedItems}
          onGoToItem={() => onGoToSkippedItem(skippedItemNotice.items[0].itemId)}
          onSubmitAnyway={onSubmitAnyway}
        />
      )}

      {exitNoticeOpen && (
        <ExitExamPanel
          answeredCount={answeredCount}
          onCancel={onCancelExit}
          onConfirm={onConfirmExit}
        />
      )}

      {expandedImage && <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />}
      {hintTarget && (
        <HintPanel
          itemNumber={hintTarget.itemNumber}
          onClose={() => setHintTarget(null)}
          question={hintTarget.question}
        />
      )}
    </section>
  )
}

type OverlayPortalProps = {
  children: ReactNode
}

function OverlayPortal({ children }: OverlayPortalProps) {
  return createPortal(children, document.body)
}

function usePopupTransition() {
  const [isVisible, setIsVisible] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const closeTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      setIsVisible(true)
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  const closeWith = useCallback((onClosed: () => void) => {
    if (isClosing) {
      return
    }

    setIsVisible(false)
    setIsClosing(true)
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null
      onClosed()
    }, POPUP_FADE_MS)
  }, [isClosing])

  const overlayClass = isVisible && !isClosing ? 'popup-overlay--open' : 'popup-overlay--closing'

  return { closeWith, overlayClass }
}

type ExitExamPanelProps = {
  answeredCount: number
  onCancel: () => void
  onConfirm: () => void
}

function ExitExamPanel({ answeredCount, onCancel, onConfirm }: ExitExamPanelProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const { closeWith, overlayClass } = usePopupTransition()

  const closePanel = useCallback(() => {
    closeWith(onCancel)
  }, [closeWith, onCancel])

  const confirmExit = useCallback(() => {
    closeWith(onConfirm)
  }, [closeWith, onConfirm])

  useEffect(() => {
    cancelButtonRef.current?.focus({ preventScroll: true })

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closePanel])

  return (
    <OverlayPortal>
      <div
        aria-labelledby="exit-exam-title"
        aria-modal="true"
        className={`exam-dialog ${overlayClass}`}
        onClick={closePanel}
        role="dialog"
      >
        <div className="exam-dialog__content" data-lenis-prevent onClick={(event) => event.stopPropagation()}>
          <p className="eyebrow">Exit exam</p>
          <h2 id="exit-exam-title">Leave this exam?</h2>
          <p className="exam-dialog__copy">
            {answeredCount > 0
              ? 'Answered items will be saved to the 2-take cooldown.'
              : 'You will return to the home screen.'}
          </p>
          <div className="exam-dialog__actions">
            <button className="button button--primary" onClick={confirmExit} type="button">
              Exit exam
            </button>
            <button className="button button--ghost" onClick={closePanel} ref={cancelButtonRef} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  )
}

type ReportQuestionPanelProps = {
  itemNumber: number
  onClose: () => void
  onSubmit: (issueDescription: string) => void
}

function ReportQuestionPanel({ itemNumber, onClose, onSubmit }: ReportQuestionPanelProps) {
  const [issueDescription, setIssueDescription] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { closeWith, overlayClass } = usePopupTransition()

  const closePanel = useCallback(() => {
    closeWith(onClose)
  }, [closeWith, onClose])

  const submitReport = useCallback(() => {
    closeWith(() => onSubmit(issueDescription))
  }, [closeWith, issueDescription, onSubmit])

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closePanel])

  return (
    <OverlayPortal>
      <div
        aria-labelledby="report-question-title"
        aria-modal="true"
        className={`exam-dialog ${overlayClass}`}
        onClick={closePanel}
        role="dialog"
      >
        <div className="exam-dialog__content report-panel" data-lenis-prevent onClick={(event) => event.stopPropagation()}>
          <p className="eyebrow">Report question</p>
          <h2 id="report-question-title">Item {itemNumber}</h2>
          <label className="report-panel__field">
            <span>Describe issue</span>
            <textarea
              maxLength={600}
              onChange={(event) => setIssueDescription(event.target.value)}
              placeholder="Example: missing context, wrong answer, image not loading..."
              ref={textareaRef}
              rows={5}
              value={issueDescription}
            />
          </label>
          <div className="exam-dialog__actions">
            <button className="button button--primary" onClick={submitReport} type="button">
              Submit
            </button>
            <button className="button button--ghost" onClick={closePanel} type="button">
              Close
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  )
}

type SkippedItemPanelProps = {
  canSubmit: boolean
  items: SkippedItem[]
  onDismiss: () => void
  onGoToItem: () => void
  onSubmitAnyway: () => void
}

function SkippedItemPanel({ canSubmit, items, onDismiss, onGoToItem, onSubmitAnyway }: SkippedItemPanelProps) {
  const goToItemButtonRef = useRef<HTMLButtonElement>(null)
  const { closeWith, overlayClass } = usePopupTransition()
  const skippedLabel = items.length === 1 ? '1 item skipped' : `${items.length} items skipped`

  const closePanel = useCallback(() => {
    closeWith(onDismiss)
  }, [closeWith, onDismiss])

  const submitAnyway = useCallback(() => {
    closeWith(onSubmitAnyway)
  }, [closeWith, onSubmitAnyway])

  const goToItem = useCallback(() => {
    closeWith(onGoToItem)
  }, [closeWith, onGoToItem])

  useEffect(() => {
    goToItemButtonRef.current?.focus({ preventScroll: true })

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closePanel])

  return (
    <OverlayPortal>
      <div
        aria-labelledby="skipped-items-title"
        aria-modal="true"
        className={`skipped-panel ${overlayClass}`}
        onClick={closePanel}
        role="dialog"
      >
        <div className="skipped-panel__content" data-lenis-prevent onClick={(event) => event.stopPropagation()}>
          <p className="eyebrow">Skipped answer</p>
          <h2 id="skipped-items-title">{skippedLabel}</h2>
          {!canSubmit && (
            <p className="exam-dialog__copy">
              Connect to the internet before submitting. Your answers are still saved here.
            </p>
          )}
          <div className="skipped-panel__actions">
            <button className="button button--primary" disabled={!canSubmit} onClick={submitAnyway} type="button">
              Submit anyway
            </button>
            <button className="button button--ghost" onClick={goToItem} ref={goToItemButtonRef} type="button">
              Go to item
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  )
}

function formatBankProgress(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  }

  return String(value)
}

function formatAttemptDate(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Saved exam'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function normalizeRequestedItemCount(rawValue: string, fallback: number): number {
  const parsedValue = parseInt(rawValue, 10)

  if (Number.isNaN(parsedValue)) {
    return fallback
  }

  return Math.min(MAX_EXAM_ITEMS, Math.max(1, Math.floor(parsedValue)))
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

type ResultsScreenProps = {
  examMode: ExamMode
  expandedImage: string | null
  filter: ReviewFilter
  filteredReviewItems: ReviewItem[]
  onToggleFilter: (option: ReviewFilterOption) => void
  onCloseImage: () => void
  onOpenImage: (imageSrc: string) => void
  onHome: () => void
  onRetake: () => void
  passed: boolean
  percentage: number
  reviewItems: ReviewItem[]
  score: number
  theme: Theme
  totalQuestions: number
  onToggleTheme: () => void
}

function ResultsScreen({
  examMode,
  expandedImage,
  filter,
  filteredReviewItems,
  onToggleFilter,
  onCloseImage,
  onOpenImage,
  onHome,
  onRetake,
  passed,
  percentage,
  reviewItems,
  score,
  theme,
  totalQuestions,
  onToggleTheme,
}: ResultsScreenProps) {
  const correctCount = reviewItems.filter((item) => item.isCorrect).length
  const wrongCount = reviewItems.length - correctCount
  const skippedCount = totalQuestions - reviewItems.length
  const isSubjectExam = examMode.kind === 'subject'
  const subjectLabel = isSubjectExam ? examMode.subject : null

  return (
    <section className="results">
      <header className="results-hero">
        <div>
          <p className="eyebrow">Results</p>
          {subjectLabel && <p className="results-subject">{subjectLabel}</p>}
          <h1>
            {score}/{totalQuestions} ({percentage}%)
          </h1>
          <p className={passed ? 'status status--pass' : 'status status--fail'}>
            {passed ? 'Passed' : 'Failed'} - passing score is 80%.
          </p>
        </div>
        <div className="results-hero__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="button button--ghost" onClick={onHome} type="button">
            Home
          </button>
          <button className="button button--primary" onClick={onRetake} type="button">
            Retake Exam
          </button>
        </div>
      </header>

      <div className="result-stats">
        <div>
          <span>{correctCount}</span>
          <p>correct</p>
        </div>
        <div>
          <span>{wrongCount}</span>
          <p>wrong</p>
        </div>
        <div>
          <span>{skippedCount}</span>
          <p>skipped</p>
        </div>
      </div>

      <div className="filter-row" role="group" aria-label="Filter reviewed answers">
        {(['correct', 'wrong'] as ReviewFilterOption[]).map((option) => (
          <button
            aria-pressed={filter.includes(option)}
            className={filter.includes(option) ? 'filter-button filter-button--active' : 'filter-button'}
            key={option}
            onClick={() => onToggleFilter(option)}
            type="button"
          >
            {option === 'correct' ? 'Correct only' : 'Wrong only'}
          </button>
        ))}
        {!isSubjectExam && SUBJECTS.map((subject) => (
          <button
            aria-pressed={filter.includes(subject)}
            className={filter.includes(subject) ? 'filter-button filter-button--active' : 'filter-button'}
            key={subject}
            onClick={() => onToggleFilter(subject)}
            type="button"
          >
            {subject}
          </button>
        ))}
      </div>

      <div className="review-list">
        {filteredReviewItems.map((item) => (
          <ReviewCard
            item={item}
            key={item.itemId}
            onOpenImage={onOpenImage}
          />
        ))}
      </div>

      {expandedImage && <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />}
    </section>
  )
}

type QuestionCardProps = {
  answers: AnswerMap
  choices: ExamSession['questions'][number]['choices']
  image?: string
  itemId: string
  itemNumber: number
  isReplacing: boolean
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onOpenHint: () => void
  onOpenImage: (imageSrc: string) => void
  onReportQuestion: (itemId: string, issueDescription: string) => void
  /** Follow-up chain items: hide repeated passage/image and refer to the anchor item. */
  passageReferItemNumber?: number
  passageAnchorPrompt?: string
  question: ExamSession['questions'][number]['question']
}

function QuestionCard({
  answers,
  choices,
  image,
  itemId,
  itemNumber,
  isReplacing,
  onChooseAnswer,
  onOpenHint,
  onOpenImage,
  onReportQuestion,
  passageReferItemNumber,
  passageAnchorPrompt,
  question,
}: QuestionCardProps) {
  const [reportPanelOpen, setReportPanelOpen] = useState(false)
  const isPassageFollowUp = typeof passageReferItemNumber === 'number'
  const displayImage = isPassageFollowUp ? undefined : image
  const displayPrompt = isPassageFollowUp && passageAnchorPrompt
    ? extractChainQuestionText(question.prompt, passageAnchorPrompt)
    : question.prompt
  const choicesHaveImages = choices.some((choice) => Boolean(choice.image))
  const markerChoicesOnly = Boolean(displayImage) && usesImageChoiceMarkers(choices) && !choicesHaveImages
  const promptIsShownInImage = hasPromptInImage(question.id, displayImage, markerChoicesOnly, displayPrompt)
  const showHintButton = Boolean(question.hint.trim()) && !isImageOnlyQuestion(question.prompt, choices, image)
  const submitReport = useCallback((issueDescription: string) => {
    setReportPanelOpen(false)
    onReportQuestion(itemId, issueDescription)
  }, [itemId, onReportQuestion])

  return (
    <article className={isReplacing ? 'question-card question-card--replacing' : 'question-card'} id={`exam-item-${itemId}`}>
      <div className="question-card__top">
        <span className="question-number">Item {itemNumber}</span>
        <div className="question-card__tools">
          {showHintButton && (
            <span className="question-tool-wrapper">
              <button
                aria-label={`Show hint for question ${question.id}`}
                className="question-tool-button hint-question-button"
                onClick={onOpenHint}
                type="button"
              >
                H
              </button>
              <span className="question-tool-tip" role="tooltip">Hint</span>
            </span>
          )}
          <span className="question-tool-wrapper">
            <button
              aria-label={`Report question ${question.id}`}
              className="question-tool-button report-question-button"
              onClick={() => setReportPanelOpen(true)}
              type="button"
            >
              R
            </button>
            <span className="question-tool-tip" role="tooltip">Report question</span>
          </span>
          <span className="subject-tag">{question.subject}</span>
        </div>
      </div>
      {isPassageFollowUp && (
        <p className="passage-refer">Refer to the item {passageReferItemNumber}.</p>
      )}
      {displayImage && (
        <button
          className="question-image-button"
          onClick={() => onOpenImage(displayImage)}
          type="button"
        >
          <img className="question-image" src={displayImage} alt="Question reference" draggable={false} />
          <span className="question-image-hint">Click to enlarge</span>
        </button>
      )}
      <PromptText
        prompt={displayPrompt}
        questionId={question.id}
        visuallyHidden={promptIsShownInImage}
      />
      <div className={[
        'choice-grid',
        markerChoicesOnly ? 'choice-grid--markers' : '',
        choicesHaveImages ? 'choice-grid--images' : '',
      ].filter(Boolean).join(' ')}>
        {choices.map((choice, index) => {
          const isSelected = answers[itemId] === choice.id
          const displayLetter = markerChoicesOnly ? choice.id.toLowerCase() : String.fromCharCode(97 + index)
          const markerTextOnly = /^(Option [a-e]|[a-e])$/i.test(choice.text.trim())

          return (
            <button
              aria-label={markerChoicesOnly ? `Choice ${displayLetter}` : undefined}
              aria-pressed={isSelected}
              className={[
                'choice',
                isSelected ? 'choice--selected' : '',
                markerChoicesOnly ? 'choice--marker-only' : '',
              ].filter(Boolean).join(' ')}
              key={choice.id}
              onClick={() => onChooseAnswer(itemId, choice.id)}
              type="button"
            >
              <span className="choice-letter">{displayLetter}</span>
              {choice.image ? (
                <img className="choice-image" src={choice.image} alt={`Choice ${displayLetter}`} draggable={false} />
              ) : (
                !markerChoicesOnly && <p><MathText text={choice.text} /></p>
              )}
              {choice.image && !markerTextOnly && <p className="choice-text"><MathText text={choice.text} /></p>}
            </button>
          )
        })}
      </div>
      {reportPanelOpen && (
        <ReportQuestionPanel
          itemNumber={itemNumber}
          onClose={() => setReportPanelOpen(false)}
          onSubmit={submitReport}
        />
      )}
    </article>
  )
}

type HintPanelProps = {
  itemNumber: number
  onClose: () => void
  question: ExamSession['questions'][number]['question']
}

function HintPanel({ itemNumber, onClose, question }: HintPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const backdropPointerStartedRef = useRef(false)
  const { closeWith, overlayClass } = usePopupTransition()

  const closePanel = useCallback(() => {
    closeWith(onClose)
  }, [closeWith, onClose])

  const closeFromBackdropClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && backdropPointerStartedRef.current) {
      closePanel()
    }

    backdropPointerStartedRef.current = false
  }, [closePanel])

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closePanel])

  return (
    <OverlayPortal>
      <div
        aria-labelledby="hint-panel-title"
        aria-modal="true"
        className={`exam-dialog ${overlayClass}`}
        onClick={closeFromBackdropClick}
        onPointerDown={(event) => {
          backdropPointerStartedRef.current = event.target === event.currentTarget
        }}
        role="dialog"
      >
        <div className="exam-dialog__content hint-panel" data-lenis-prevent onClick={(event) => event.stopPropagation()}>
          <p className="eyebrow">Item {itemNumber}</p>
          <h2 id="hint-panel-title">Hint</h2>
          <p className="hint-panel__text"><MathText text={question.hint} /></p>
          <div className="exam-dialog__actions">
            <button className="button button--primary" onClick={closePanel} ref={closeButtonRef} type="button">
              Close
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  )
}

type ReviewCardProps = {
  item: ReviewItem
  onOpenImage: (imageSrc: string) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatReviewExplanation(
  explanation: string,
  correctChoiceText: string,
  options?: { isCorrect?: boolean },
): string {
  let text = explanation.trim()

  // Strip boilerplate that only restates the letter / choice text.
  const boilerplatePatterns = [
    /^The correct answer is choice [A-E]\s*(?:\(["“][^"”]+["”]\))?\s*because\s+/i,
    /^The correct answer is [A-E]\s*[:.\-–—]\s*["'“]?/i,
    /^Correct answer is choice [A-E]\s*(?:\(["“][^"”]+["”]\))?\s*(?:because\s+)?/i,
    /^Tamang sagot ang choice [A-E]\s*(?:\(["“][^"”]+["”]\))?\s*dahil\s+/i,
    /^Ang tamang sagot ay [A-E]\s*[:.\-–—]\s*["'“]?/i,
  ]
  for (const pattern of boilerplatePatterns) {
    text = text.replace(pattern, '')
  }

  text = text.replace(/^[A-E](?:\.\)|\.|\))\s*/i, '')

  const answerText = correctChoiceText.trim()
  if (answerText) {
    const quotedAnswer = new RegExp(
      `^["'“]?${escapeRegExp(answerText)}["'”]?\\s*(?:[✔✓])?(?:\\s*[-:–—.]\\s*|\\s+)?`,
      'i',
    )
    text = text.replace(quotedAnswer, '')
  }

  // Drop empty residue like “it is the option supported by the passage.”
  text = text
    .replace(/^it is the option supported by the passage\.?$/i, '')
    .replace(/^the option supported by the passage\.?$/i, '')
    .replace(/^dahil ito ang impormasyong sinusuportahan ng talata\.?$/i, '')
    .replace(/^ito ang impormasyong sinusuportahan ng talata\.?$/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^\.\s*/, '')
    .trim()

  if (!text) {
    if (options?.isCorrect === false) {
      return 'The letter alone is not enough—go back to the passage and pin the option to a specific line of evidence.'
    }
    return ''
  }

  return text.replace(/^./, (firstLetter) => firstLetter.toUpperCase())
}

function ReviewCard({ item, onOpenImage }: ReviewCardProps) {
  const [explanationOpen, setExplanationOpen] = useState(false)
  const isPassageFollowUp = typeof item.passageReferItemNumber === 'number'
  const displayImage = isPassageFollowUp ? undefined : item.image
  const displayPrompt = isPassageFollowUp && item.passageAnchorPrompt
    ? extractChainQuestionText(item.prompt, item.passageAnchorPrompt)
    : item.prompt
  const choicesHaveImages = item.choices.some((choice) => Boolean(choice.image))
  const markerChoicesOnly = Boolean(displayImage) && usesImageChoiceMarkers(item.choices) && !choicesHaveImages
  const promptIsShownInImage = hasPromptInImage(item.questionId, displayImage, markerChoicesOnly, displayPrompt)
  const correctChoice = item.choices.find((choice) => choice.id === item.correctChoiceId)

  const cleanedExplanation = item.explanation
    ? formatReviewExplanation(
        item.explanation,
        correctChoice?.text ?? '',
        { isCorrect: item.isCorrect },
      )
    : ''

  const choiceBreakdown = item.choices
    .map((choice) => {
      const note = (choice.explanation || '').trim()
      if (!note) {
        return null
      }
      return { choice, note }
    })
    .filter((entry): entry is { choice: (typeof item.choices)[number]; note: string } => Boolean(entry))

  const hasExpandableExplanation = Boolean(cleanedExplanation) || choiceBreakdown.length > 0

  return (
    <article className="review-card">
      <div className="question-card__top">
        <span className="question-number">Item {item.itemNumber}</span>
        <span className="subject-tag">{item.subject}</span>
      </div>
      {isPassageFollowUp && (
        <p className="passage-refer">Refer to the item {item.passageReferItemNumber}.</p>
      )}
      {displayImage && (
        <button
          className="question-image-button"
          onClick={() => onOpenImage(displayImage)}
          type="button"
        >
          <img className="question-image" src={displayImage} alt="Question reference" draggable={false} />
          <span className="question-image-hint">Click to enlarge</span>
        </button>
      )}
      <PromptText
        prompt={displayPrompt}
        questionId={item.questionId}
        visuallyHidden={promptIsShownInImage}
      />



      <div className={[
        'review-choices',
        markerChoicesOnly ? 'review-choices--markers' : '',
        choicesHaveImages ? 'review-choices--images' : '',
      ].filter(Boolean).join(' ')}>
        {item.choices
          .filter((choice) => choice.id === item.selectedChoiceId || choice.id === item.correctChoiceId)
          .map((choice) => {
          const isSelected = item.selectedChoiceId === choice.id
          const isCorrect = item.correctChoiceId === choice.id
          const className = [
            'review-choice',
            isCorrect ? 'review-choice--correct' : '',
            isSelected && !isCorrect ? 'review-choice--wrong' : '',
            markerChoicesOnly ? 'review-choice--marker-only' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const displayLetter = choice.id.toLowerCase()
          const markerTextOnly = /^(Option [a-e]|[a-e])$/i.test(choice.text.trim())

          const tagLabel =
            isSelected && isCorrect
              ? 'Correct answer'
              : isSelected
                ? 'Your answer'
                : isCorrect
                  ? 'Correct answer'
                  : null

          return (
            <div className={className} key={choice.id}>
              <span className="review-choice__letter">{displayLetter}</span>
              {choice.image ? (
                <img className="choice-image" src={choice.image} alt={`Choice ${displayLetter}`} draggable={false} />
              ) : (
                !markerChoicesOnly && <p><MathText text={choice.text} /></p>
              )}
              {choice.image && !markerTextOnly && <p><MathText text={choice.text} /></p>}
              {tagLabel && (
                <span className={`review-choice__tag${isCorrect ? ' review-choice__tag--correct' : ''}${isSelected && !isCorrect ? ' review-choice__tag--wrong' : ''}`}>
                  {tagLabel}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {hasExpandableExplanation && (
        <div className="explanation-panel">
          <button
            aria-expanded={explanationOpen}
            className="explanation-toggle"
            onClick={() => setExplanationOpen((open) => !open)}
            type="button"
          >
            <span>{explanationOpen ? 'Hide explanation' : 'Show explanation'}</span>
            <span className={`explanation-toggle__chevron${explanationOpen ? ' explanation-toggle__chevron--open' : ''}`} aria-hidden>
              ▾
            </span>
          </button>
          <div
            className={`explanation-collapse${explanationOpen ? ' explanation-collapse--open' : ''}`}
          >
            <div className="explanation-collapse__inner">
              {cleanedExplanation && (
                <div className="explanation">
                  <p>
                    <strong>Explanation:</strong> <MathText text={cleanedExplanation} />
                  </p>
                </div>
              )}
              {choiceBreakdown.length > 0 && (
                <ul className="choice-explanations">
                  {choiceBreakdown.map(({ choice, note }) => {
                    const isCorrect = choice.id === item.correctChoiceId
                    const isSelected = choice.id === item.selectedChoiceId
                    return (
                      <li
                        className={[
                          'choice-explanations__item',
                          isCorrect ? 'choice-explanations__item--correct' : '',
                          isSelected && !isCorrect ? 'choice-explanations__item--yours' : '',
                        ].filter(Boolean).join(' ')}
                        key={choice.id}
                      >
                        <p className="choice-explanations__label">
                          Choice {choice.id}
                          {isCorrect ? ' · correct' : ''}
                          {isSelected && !isCorrect ? ' · your answer' : ''}
                          {isSelected && isCorrect ? ' · your answer' : ''}
                        </p>
                        <p className="choice-explanations__text"><MathText text={note} /></p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

/** Strip shared passage text so follow-up chain items show only the unique question. */
function extractChainQuestionText(prompt: string, firstPrompt: string): string {
  let shared = 0
  const limit = Math.min(prompt.length, firstPrompt.length)
  while (shared < limit && prompt[shared] === firstPrompt[shared]) {
    shared += 1
  }

  let cut = shared
  const lastNewline = prompt.lastIndexOf('\n', Math.max(0, shared - 1))
  if (lastNewline >= 0 && shared - lastNewline < 120) {
    cut = lastNewline + 1
  }

  const tail = prompt.slice(cut).trim()
  return tail || prompt
}

type PromptTextProps = {
  prompt: string
  questionId: string
  visuallyHidden?: boolean
}

function PromptText({ prompt, questionId, visuallyHidden = false }: PromptTextProps) {
  const headingClassName = visuallyHidden ? 'sr-only' : undefined

  if (PRESERVE_PROMPT_LINE_IDS.has(questionId) || looksLikeVersePrompt(prompt)) {
    const lines = prompt.split('\n')

    return (
      <h2 className={headingClassName}>
        {lines.map((line, index) => (
          <span
            className={line.trim() ? 'prompt-line' : 'prompt-line prompt-line--blank'}
            key={`${questionId}-${index}`}
          >
            {line.trim() ? <MathText text={line} /> : '\u00a0'}
          </span>
        ))}
      </h2>
    )
  }

  if (!LINE_BREAK_PROMPT_IDS.has(questionId) && !isDataSufficiencyPrompt(prompt) && !prompt.includes('\n')) {
    return <h2 className={headingClassName}><MathText text={prompt} /></h2>
  }

  const lines = formatPromptLines(prompt)

  return (
    <h2 className={headingClassName}>
      {lines.map((line, index) => (
        <span
          className={line.trim() ? 'prompt-line' : 'prompt-line prompt-line--blank'}
          key={`${questionId}-${index}`}
        >
          {line.trim() ? <MathText text={line} /> : ' '}
        </span>
      ))}
    </h2>
  )
}

function ReportPrompt({ prompt }: { prompt: string }) {
  const cleanPrompt = prompt.replace(/\n\nContext: (?:[A-Z]|[IVX]+)\. reading passage$/u, '')
  const lines = formatPromptLines(cleanPrompt)

  if (lines.length <= 1) {
    return <p><MathText text={cleanPrompt} /></p>
  }

  return (
    <p>
      {lines.map((line, index) => (
        <span className="prompt-line" key={`${line}-${index}`}>
          <MathText text={line} />
        </span>
      ))}
    </p>
  )
}

function createReportPrompt(prompt: string): string {
  const parts = prompt.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean)

  if (parts.length < 2) {
    return prompt
  }

  const question = parts[parts.length - 1]
  const passage = parts.slice(0, -1).join(' ')

  if (passage.length < 500 || question.length > 220) {
    return prompt
  }

  return question
}

function usesImageChoiceMarkers(choices: { text: string }[]): boolean {
  const markerChoicePattern =
    /^(Option [a-e]|Underlined part [a-e]|Salungguhit [a-e]|No error(?: \/ walang mali)?|Walang mali)$/i

  return choices.length > 0 && choices.every((choice) => markerChoicePattern.test(choice.text.trim()))
}

function isImageOnlyQuestion(prompt: string, choices: { text: string }[], image: string | undefined): boolean {
  if (!image) {
    return false
  }

  const promptPointsToImageOnly = /Use the figure shown in the source image|Use the source image|Abstract Reasoning item/i.test(prompt)
  const choicesAreOnlyMarkers = choices.length > 0 && choices.every((choice) => /^(Option [a-e]|[a-e])$/i.test(choice.text.trim()))

  return promptPointsToImageOnly && choicesAreOnlyMarkers
}

function hasPromptInImage(
  questionId: string,
  image: string | undefined,
  markerChoicesOnly: boolean,
  prompt?: string,
): boolean {
  if (!image) return false
  if (markerChoicesOnly || PROMPT_IN_IMAGE_IDS.has(questionId)) return true
  // Error-identification items: the image already shows the underlined sentence;
  // hide the (often OCR-broken) text prompt and keep only image + choices.
  if (
    prompt &&
    /Choose the underlined part that contains an error|Piliin ang salitang may salungguhit|Identifying errors item/i.test(
      prompt,
    )
  ) {
    return true
  }
  return false
}

function formatPromptLines(prompt: string): string[] {
  const structured = prompt
    .replace(/^([IVX]+)\.\s+([A-E]\.)/u, '$1.\n$2')
    .replace(/\s+([A-E]\.\s)/gu, '\n$1')
    .replace(/\s+([12]\))\s*/gu, '\n$1 ')

  // Preserve blank lines (paragraph breaks). Collapse only soft single newlines
  // between long prose lines — never collapse short verse/poem lines.
  const collapsed = structured.replace(/([^\n])\n(?!\n)/gu, (full, before, offset, whole) => {
    const afterMatch = whole.slice(offset + full.length).match(/^([^\n]*)/)
    const after = afterMatch ? afterMatch[1] : ''
    const beforeLineStart = whole.lastIndexOf('\n', offset - 1) + 1
    const beforeLine = whole.slice(beforeLineStart, offset) + before
    const shortVerse = beforeLine.trim().length > 0 && beforeLine.trim().length <= 48
    const afterShort = after.trim().length > 0 && after.trim().length <= 48
    const keepBreak =
      shortVerse ||
      afterShort ||
      /^(What|Alin|Ano|Basahin|Arrange|This paragraph)\b/u.test(after.trim()) ||
      /^[IVX]+\.$/u.test(after.trim()) ||
      /^[A-E]\.\s/u.test(after.trim()) ||
      /^[12]\)\s/u.test(after.trim())
    return keepBreak ? full : before + ' '
  })

  return collapsed.split('\n').map((line) => line.trimEnd())
}


function isDataSufficiencyPrompt(prompt: string): boolean {
  return /\b1\)/u.test(prompt) && /\b2\)/u.test(prompt)
}

type ImageLightboxProps = {
  imageSrc: string
  onClose: () => void
}

function ImageLightbox({ imageSrc, onClose }: ImageLightboxProps) {
  const { closeWith, overlayClass } = usePopupTransition()

  const closeLightbox = useCallback(() => {
    closeWith(onClose)
  }, [closeWith, onClose])

  const closeLightboxFromBackdrop = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeLightbox()
    }
  }, [closeLightbox])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeLightbox()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closeLightbox, imageSrc])

  return (
    <OverlayPortal>
      <div
        aria-modal="true"
        className={`image-lightbox ${overlayClass}`}
        data-lenis-prevent
        onClick={closeLightboxFromBackdrop}
        role="dialog"
      >
        <button
          aria-label="Close image preview"
          className="image-lightbox__close"
          onClick={closeLightbox}
          type="button"
        >
          {'\u00d7'}
        </button>
        <div className="image-lightbox__content">
          <img className="image-lightbox__image" src={imageSrc} alt="Expanded question reference" draggable={false} />
        </div>
      </div>
    </OverlayPortal>
  )
}

export default App
