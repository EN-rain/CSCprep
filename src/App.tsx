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
  type Subject,
} from './types'
import {
  completeExam,
  createExamSession,
  getAnsweredHistoryCount,
  getLoadedQuestionCount,
  resetQuestionHistory,
} from './utils/exam'
import { questionBank } from './data/questionBank'

type Screen = 'home' | 'exam' | 'results' | 'history' | 'reports'
type Theme = 'light' | 'dark'
type ScreenTransition = 'idle' | 'content-exit' | 'content-enter'
const TIMED_EXAM_SECONDS = 60 * 60
const THEME_KEY = 'cscprep-theme'
const EXAM_ATTEMPT_HISTORY_KEY = 'cscprep:exam-attempt-history:v2'
const IN_PROGRESS_EXAM_KEY = 'cscprep:in-progress-exam:v1'
const QUESTION_REPORTS_KEY = 'cscprep:question-reports:v1'
const SCREEN_EXIT_MS = 300
const SCREEN_ENTER_MS = 420
const POPUP_FADE_MS = 320

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
}

type SkippedItem = {
  itemId: string
  itemNumber: number
}

type SkippedItemNotice = {
  items: SkippedItem[]
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
  'vr-300',
  'vr-301',
  'vr-302',
  'vr-303',
  'vr-304',
  'vr-431',
  'csc10-064',
])

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
  const currentQuestions = new Map(questionBank.map((question) => [question.id, question]))

  return {
    ...session,
    questions: session.questions.map((examQuestion) => {
      const currentQuestion = currentQuestions.get(examQuestion.question.id)

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

function readQuestionReports(): QuestionReport[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(QUESTION_REPORTS_KEY)
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
        typeof candidate.reportedAt === 'string'
      )
    })
  } catch {
    return []
  }
}

function writeQuestionReports(reports: QuestionReport[]): void {
  window.localStorage.setItem(QUESTION_REPORTS_KEY, JSON.stringify(reports))
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
  const [submittedAnswers, setSubmittedAnswers] = useState<AnswerMap>({})
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(() => initialExamDraft?.remainingSeconds ?? TIMED_EXAM_SECONDS)
  const [answeredHistoryCount, setAnsweredHistoryCount] = useState(() => getAnsweredHistoryCount())
  const [loadedQuestionCount] = useState(() => getLoadedQuestionCount())
  const [savedAttempts, setSavedAttempts] = useState<SavedExamAttempt[]>(() => readExamAttemptHistory())
  const [questionReports, setQuestionReports] = useState<QuestionReport[]>(() => readQuestionReports())
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [skippedItemNotice, setSkippedItemNotice] = useState<SkippedItemNotice>(() => initialExamDraft?.skippedItemNotice ?? null)
  const [skippedItemQueue, setSkippedItemQueue] = useState<SkippedItem[]>(() => initialExamDraft?.skippedItemQueue ?? [])
  const [activeSkippedItemId, setActiveSkippedItemId] = useState<string | null>(() => initialExamDraft?.activeSkippedItemId ?? null)
  const [exitNoticeOpen, setExitNoticeOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(getOnlineStatus)
  const [offlineSubmitNoticeOpen, setOfflineSubmitNoticeOpen] = useState(false)
  const [screenTransition, setScreenTransition] = useState<ScreenTransition>('idle')
  const transitionTimeoutRef = useRef<number | null>(null)

  const totalQuestions = session?.questions.length ?? 0
  const answeredCount = Object.keys(answers).length
  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (!session) {
      return []
    }

    return session.questions.flatMap(({ id, itemNumber, question, choices }) => {
        const selectedChoiceId = submittedAnswers[id]

        if (!selectedChoiceId) {
          return []
        }

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
        }]
      })
  }, [session, submittedAnswers])

  const score = reviewItems.filter((item) => item.isCorrect).length
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0
  const passed = percentage >= 80
  const filteredReviewItems = reviewItems.filter((item) => {
    if (filter === 'correct') {
      return item.isCorrect
    }

    if (filter === 'wrong') {
      return !item.isCorrect
    }

    return true
  })
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
    const nextSession = createExamSession(mode, timerEnabled)
    const openExam = () => {
      setSession(nextSession)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter('all')
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setRemainingSeconds(TIMED_EXAM_SECONDS)
      setScreen('exam')
    }

    transitionToScreen(openExam)
  }

  function chooseAnswer(questionId: string, choiceId: ChoiceId) {
    setAnswers((current) => ({
      ...current,
      [questionId]: choiceId,
    }))
  }

  function submitExam() {
    if (!session) {
      return
    }

    if (!isOnline) {
      setOfflineSubmitNoticeOpen(true)
      return
    }

    const skippedQuestions = session.questions
      .filter(({ id }) => !answers[id])
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

    finishExamWithAnswers(answers)
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
      document.getElementById(`exam-item-${itemId}`)?.scrollIntoView({
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
      setFilter('all')
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
      setFilter('all')
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('history')
    })
  }

  function openReports() {
    transitionToScreen(() => {
      setFilter('all')
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setOfflineSubmitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('reports')
    })
  }

  function reportQuestion(itemId: string) {
    if (!session) {
      return
    }

    const examQuestion = session.questions.find((item) => item.id === itemId)

    if (!examQuestion) {
      return
    }

    setQuestionReports((currentReports) => {
      const report: QuestionReport = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        questionId: examQuestion.question.id,
        itemNumber: examQuestion.itemNumber,
        subject: examQuestion.question.subject,
        prompt: examQuestion.question.prompt,
        reportedAt: new Date().toISOString(),
      }
      const nextReports = [report, ...currentReports].slice(0, 200)
      writeQuestionReports(nextReports)

      return nextReports
    })
  }

  function deleteQuestionReport(reportId: string) {
    const nextReports = questionReports.filter((report) => report.id !== reportId)
    writeQuestionReports(nextReports)
    setQuestionReports(nextReports)
  }

  function clearQuestionReports() {
    writeQuestionReports([])
    setQuestionReports([])
  }

  function openSavedAttempt(attempt: SavedExamAttempt) {
    transitionToScreen(() => {
      const refreshedSession = refreshExamSessionQuestions(attempt.session)

      clearInProgressExamDraft()
      setSession(refreshedSession)
      setAnswers(attempt.answers)
      setSubmittedAnswers(attempt.answers)
      setFilter('all')
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
      setFilter('all')
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

    finishExamWithAnswers(answers)
  }, [answers, remainingSeconds, screen, screenTransition, session?.timed])

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

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      return
    }

    const lenis = new Lenis({
      autoRaf: true,
      anchors: true,
      lerp: 0.08,
    })

    return () => lenis.destroy()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (screen !== 'results') {
      return
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }, [screen])

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
            expandedImage={expandedImage}
            filter={filter}
            filteredReviewItems={filteredReviewItems}
            onFilterChange={setFilter}
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
            reports={questionReports}
            onClearReports={clearQuestionReports}
            onDeleteReport={deleteQuestionReport}
            onHome={goHome}
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
  theme,
  onToggleTheme,
}: HomeScreenProps) {
  return (
    <section className="home">
      <div className="home__content">
        <div>
          <p className="eyebrow">Civil Service Exam Practice</p>
          <h1>CSCprep</h1>
          <p className="tagline">Practice with anonymous 100-item exams, subject drills, instant results, and local cooldown tracking.</p>
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
            <button
              aria-pressed={timerEnabled}
              className={timerEnabled ? 'toggle toggle--active' : 'toggle'}
              type="button"
              onClick={onToggleTimer}
            >
              <span className="toggle__label">Timer</span>
              <span className="toggle__state">{timerEnabled ? 'On' : 'Off'}</span>
            </button>
            <button className="button button--ghost button--compact" type="button" onClick={onOpenHistory}>
              History {savedAttemptCount > 0 ? `(${savedAttemptCount})` : ''}
            </button>
          </div>
        </div>
        <div className="start-grid">
          <button
            className="start-option"
            type="button"
            onClick={() => onStartExam({ kind: 'mixed' })}
          >
            <strong>Random Exam</strong>
          </button>
          {SUBJECTS.map((subject) => (
            <button
              className="start-option"
              key={subject}
              onClick={() => onStartExam({ kind: 'subject', subject })}
              type="button"
            >
              <strong>{subject} Exam</strong>
            </button>
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
  reports: QuestionReport[]
  onClearReports: () => void
  onDeleteReport: (reportId: string) => void
  onHome: () => void
  theme: Theme
  onToggleTheme: () => void
}

function ReportsScreen({
  reports,
  onClearReports,
  onDeleteReport,
  onHome,
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
        </div>
        <div className="results-hero__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="button button--ghost" onClick={onHome} type="button">
            Home
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
            {reports.map((report) => (
              <article className="report-row" key={report.id}>
                <div>
                  <div className="report-row__meta">
                    <strong>{report.questionId}</strong>
                    <span>Item {report.itemNumber}</span>
                    <span>{report.subject}</span>
                    <span>{formatAttemptDate(report.reportedAt)}</span>
                  </div>
                  <p>{report.prompt}</p>
                </div>
                <button
                  className="attempt-row__delete"
                  onClick={() => onDeleteReport(report.id)}
                  type="button"
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
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
  onReportQuestion: (itemId: string) => void
  onSubmit: () => void
  onSubmitAnyway: () => void
  nextSkippedItem: SkippedItem | null
  offlineSubmitNoticeOpen: boolean
  remainingSeconds: number
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
  session,
  skippedItemNotice,
  theme,
  totalQuestions,
  onToggleTheme,
}: ExamScreenProps) {
  const unansweredCount = totalQuestions - answeredCount

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
        {session.questions.map(({ id, itemNumber, question, choices }) => (
          <QuestionCard
            answers={answers}
            itemId={id}
            itemNumber={itemNumber}
            key={id}
            onChooseAnswer={onChooseAnswer}
            onOpenImage={onOpenImage}
            onReportQuestion={onReportQuestion}
            question={question}
            choices={choices}
          />
        ))}
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

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

type ResultsScreenProps = {
  expandedImage: string | null
  filter: ReviewFilter
  filteredReviewItems: ReviewItem[]
  onFilterChange: (filter: ReviewFilter) => void
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
  expandedImage,
  filter,
  filteredReviewItems,
  onFilterChange,
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

  return (
    <section className="results">
      <header className="results-hero">
        <div>
          <p className="eyebrow">Results</p>
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
        {(['all', 'correct', 'wrong'] as ReviewFilter[]).map((option) => (
          <button
            aria-pressed={filter === option}
            className={filter === option ? 'filter-button filter-button--active' : 'filter-button'}
            key={option}
            onClick={() => onFilterChange(option)}
            type="button"
          >
            {option === 'all' ? 'All items' : option === 'correct' ? 'Correct only' : 'Wrong only'}
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
  itemId: string
  itemNumber: number
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onOpenImage: (imageSrc: string) => void
  onReportQuestion: (itemId: string) => void
  question: ExamSession['questions'][number]['question']
}

function QuestionCard({
  answers,
  choices,
  itemId,
  itemNumber,
  onChooseAnswer,
  onOpenImage,
  onReportQuestion,
  question,
}: QuestionCardProps) {
  const markerChoicesOnly = Boolean(question.image) && usesImageChoiceMarkers(choices)
  const promptIsShownInImage = hasPromptInImage(question.id, question.image, markerChoicesOnly)

  return (
    <article className="question-card" id={`exam-item-${itemId}`}>
      <div className="question-card__top">
        <span className="question-number">Item {itemNumber}</span>
        <div className="question-card__tools">
          <button
            aria-label={`Report question ${question.id}`}
            className="report-question-button"
            onClick={() => onReportQuestion(itemId)}
            title={`Report question ${question.id}`}
            type="button"
          >
            R
          </button>
          <span className="subject-tag">{question.subject}</span>
        </div>
      </div>
      {question.image && (
        <button
          className="question-image-button"
          onClick={() => onOpenImage(question.image!)}
          type="button"
        >
          <img className="question-image" src={question.image} alt="Question reference" draggable={false} />
          <span className="question-image-hint">Click to enlarge</span>
        </button>
      )}
      <PromptText
        prompt={question.prompt}
        questionId={question.id}
        visuallyHidden={promptIsShownInImage}
      />
      <div className={markerChoicesOnly ? 'choice-grid choice-grid--markers' : 'choice-grid'}>
        {choices.map((choice, index) => {
          const isSelected = answers[itemId] === choice.id
          const displayLetter = markerChoicesOnly ? choice.id.toLowerCase() : String.fromCharCode(97 + index)

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
              <span>{displayLetter}</span>
              {!markerChoicesOnly && choice.text}
            </button>
          )
        })}
      </div>
    </article>
  )
}

type ReviewCardProps = {
  item: ReviewItem
  onOpenImage: (imageSrc: string) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatReviewExplanation(explanation: string, correctChoiceText: string): string {
  const trimmedExplanation = explanation.trim()
  const repeatedAnswerPrefixes = [
    /^The correct answer is choice [A-E](?: \("[^"]+"\))? because\s+/i,
    /^Tamang sagot ang choice [A-E](?: \("[^"]+"\))? dahil\s+/i,
  ]
  const withoutRepeatedAnswer = repeatedAnswerPrefixes.reduce(
    (currentExplanation, repeatedAnswerPrefix) => currentExplanation.replace(repeatedAnswerPrefix, ''),
    trimmedExplanation,
  )
  const leadingChoiceMarker = /^[A-E](?:\.\)|\.|\))\s*/i
  const hadLeadingChoiceMarker = leadingChoiceMarker.test(withoutRepeatedAnswer)
  const withoutChoiceMarker = withoutRepeatedAnswer.replace(leadingChoiceMarker, '')
  const answerText = correctChoiceText.trim()
  const repeatedAnswerText = answerText
    ? new RegExp(`^${escapeRegExp(answerText)}\\s*(?:[✔✓])?(?:\\s*[-:–—.]\\s*|\\s+)?`, 'i')
    : null
  const cleanedExplanation =
    hadLeadingChoiceMarker && repeatedAnswerText
      ? withoutChoiceMarker.replace(repeatedAnswerText, '')
      : withoutChoiceMarker

  return cleanedExplanation.replace(/^./, (firstLetter) => firstLetter.toUpperCase())
}

function ReviewCard({ item, onOpenImage }: ReviewCardProps) {
  const markerChoicesOnly = Boolean(item.image) && usesImageChoiceMarkers(item.choices)
  const promptIsShownInImage = hasPromptInImage(item.questionId, item.image, markerChoicesOnly)
  const correctChoice = item.choices.find((choice) => choice.id === item.correctChoiceId)

  return (
    <article className="review-card">
      <div className="question-card__top">
        <span className="question-number">Item {item.itemNumber}</span>
        <span className="subject-tag">{item.subject}</span>
      </div>
      {item.image && (
        <button
          className="question-image-button"
          onClick={() => onOpenImage(item.image!)}
          type="button"
        >
          <img className="question-image" src={item.image} alt="Question reference" draggable={false} />
          <span className="question-image-hint">Click to enlarge</span>
        </button>
      )}
      <PromptText
        prompt={item.prompt}
        questionId={item.questionId}
        visuallyHidden={promptIsShownInImage}
      />
      {item.explanation && (
        <div className="explanation">
          <p className="explanation__answer">{item.correctChoiceId}.</p>
          <p>
            <strong>Explanation:</strong> {formatReviewExplanation(item.explanation, correctChoice?.text ?? '')}
          </p>
        </div>
      )}
      <div className={markerChoicesOnly ? 'review-choices review-choices--markers' : 'review-choices'}>
        {item.choices.map((choice, index) => {
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
          const displayLetter = markerChoicesOnly ? choice.id.toLowerCase() : String.fromCharCode(97 + index)

          return (
            <div className={className} key={choice.id}>
              <span>{displayLetter}</span>
              {!markerChoicesOnly && <p>{choice.text}</p>}
              {isSelected && <strong>Your answer</strong>}
              {isCorrect && <strong>Correct</strong>}
            </div>
          )
        })}
      </div>
    </article>
  )
}

type PromptTextProps = {
  prompt: string
  questionId: string
  visuallyHidden?: boolean
}

function PromptText({ prompt, questionId, visuallyHidden = false }: PromptTextProps) {
  const headingClassName = visuallyHidden ? 'sr-only' : undefined

  if (PRESERVE_PROMPT_LINE_IDS.has(questionId)) {
    const lines = prompt.split('\n')

    return (
      <h2 className={headingClassName}>
        {lines.map((line, index) => (
          <span
            className={line.trim() ? 'prompt-line' : 'prompt-line prompt-line--blank'}
            key={`${questionId}-${index}`}
          >
            {line.trim() ? line : '\u00a0'}
          </span>
        ))}
      </h2>
    )
  }

  if (!LINE_BREAK_PROMPT_IDS.has(questionId)) {
    return <h2 className={headingClassName}>{prompt}</h2>
  }

  const lines = formatPromptLines(prompt)

  return (
    <h2 className={headingClassName}>
      {lines.map((line, index) => (
        <span className="prompt-line" key={`${questionId}-${index}`}>
          {line}
        </span>
      ))}
    </h2>
  )
}

function usesImageChoiceMarkers(choices: { text: string }[]): boolean {
  const markerChoicePattern = /^(Underlined part [a-e]|No error(?: \/ walang mali)?)$/i

  return choices.length > 0 && choices.every((choice) => markerChoicePattern.test(choice.text.trim()))
}

function hasPromptInImage(questionId: string, image: string | undefined, markerChoicesOnly: boolean): boolean {
  return Boolean(image) && (markerChoicesOnly || PROMPT_IN_IMAGE_IDS.has(questionId))
}

function formatPromptLines(prompt: string): string[] {
  return prompt
    .replace(/^([IVX]+)\.\s+([A-E]\.)/u, '$1.\n$2')
    .replace(/\s+([A-E]\.\s)/gu, '\n$1')
    .replace(/\s+([12]\)\s)/gu, '\n$1')
    .replace(/\n(?!\n|[IVX]+\.$|[A-E]\.\s|[12]\)\s|What\b)/gu, ' ')
    .split('\n')
    .map((line) => line.trim())
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
