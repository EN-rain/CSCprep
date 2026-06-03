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

type Screen = 'home' | 'exam' | 'results' | 'history'
type Theme = 'light' | 'dark'
type ScreenTransition = 'idle' | 'content-exit' | 'content-enter'
const TIMED_EXAM_SECONDS = 60 * 60
const THEME_KEY = 'cscprep-theme'
const EXAM_ATTEMPT_HISTORY_KEY = 'cscprep:exam-attempt-history:v1'
const SCREEN_EXIT_MS = 300
const SCREEN_ENTER_MS = 420
const POPUP_FADE_MS = 320
const SUBJECT_CHART_COLORS: Record<Subject, string> = {
  'Verbal Reasoning': '#0f766e',
  'Numerical Reasoning': '#2563eb',
  'Analytical Ability': '#d97706',
  Filipino: '#c026d3',
  'General Information': '#dc2626',
}
const DUMMY_HISTORY_PRESETS: Array<Record<Subject, number>> = [
  {
    'Verbal Reasoning': 62,
    'Numerical Reasoning': 48,
    'Analytical Ability': 70,
    Filipino: 58,
    'General Information': 52,
  },
  {
    'Verbal Reasoning': 68,
    'Numerical Reasoning': 56,
    'Analytical Ability': 74,
    Filipino: 64,
    'General Information': 60,
  },
  {
    'Verbal Reasoning': 74,
    'Numerical Reasoning': 63,
    'Analytical Ability': 79,
    Filipino: 70,
    'General Information': 67,
  },
]

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

type SubjectChartPoint = {
  x: number
  y: number
}

type SubjectChartSeries = {
  subject: Subject
  color: string
  points: SubjectChartPoint[]
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

    return Array.isArray(parsed) ? (parsed as SavedExamAttempt[]) : []
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

function getWrongChoiceId(question: ExamSession['questions'][number]['question']): ChoiceId {
  return question.choices.find((choice) => choice.id !== question.correctChoiceId)?.id ?? question.correctChoiceId
}

function createDummyExamAttempt(index: number, subjectTargets: Record<Subject, number>): SavedExamAttempt {
  const session = createExamSession({ kind: 'mixed' }, false)
  const answers: AnswerMap = {}

  SUBJECTS.forEach((subject) => {
    const subjectQuestions = session.questions.filter(({ question }) => question.subject === subject)
    const correctTarget = Math.round((subjectQuestions.length * subjectTargets[subject]) / 100)

    subjectQuestions.forEach(({ id, question }, questionIndex) => {
      answers[id] = questionIndex < correctTarget ? question.correctChoiceId : getWrongChoiceId(question)
    })
  })

  const savedAttempt = createSavedExamAttempt(session, answers)
  const submittedAt = new Date()
  submittedAt.setDate(submittedAt.getDate() - (DUMMY_HISTORY_PRESETS.length - index))

  return {
    ...savedAttempt,
    id: `dummy-history-${index + 1}`,
    submittedAt: submittedAt.toISOString(),
    title: `Dummy Exam ${index + 1}`,
  }
}

function createDummyExamHistory(): SavedExamAttempt[] {
  return DUMMY_HISTORY_PRESETS.map((preset, index) => createDummyExamAttempt(index, preset)).reverse()
}

function buildSubjectChartSeries(attempts: SavedExamAttempt[]): SubjectChartSeries[] {
  const chronologicalAttempts = [...attempts].reverse()
  const left = 56
  const right = 676
  const top = 28
  const bottom = 234
  const lastIndex = Math.max(chronologicalAttempts.length - 1, 1)

  return SUBJECTS.map((subject) => {
    const points = chronologicalAttempts.map<SubjectChartPoint>((attempt, index) => {
      const stat = attempt.subjectStats.find((subjectStat) => subjectStat.subject === subject)
      const percent = stat && stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0

      return {
        x: left + ((right - left) * index) / lastIndex,
        y: bottom - ((bottom - top) * percent) / 100,
      }
    })

    return {
      subject,
      color: SUBJECT_CHART_COLORS[subject],
      points,
    }
  })
}

function App() {
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
  const [screen, setScreen] = useState<Screen>('home')
  const [session, setSession] = useState<ExamSession | null>(null)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [submittedAnswers, setSubmittedAnswers] = useState<AnswerMap>({})
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(TIMED_EXAM_SECONDS)
  const [answeredHistoryCount, setAnsweredHistoryCount] = useState(() => getAnsweredHistoryCount())
  const [loadedQuestionCount] = useState(() => getLoadedQuestionCount())
  const [savedAttempts, setSavedAttempts] = useState<SavedExamAttempt[]>(() => readExamAttemptHistory())
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [skippedItemNotice, setSkippedItemNotice] = useState<SkippedItemNotice>(null)
  const [skippedItemQueue, setSkippedItemQueue] = useState<SkippedItem[]>([])
  const [activeSkippedItemId, setActiveSkippedItemId] = useState<string | null>(null)
  const [exitNoticeOpen, setExitNoticeOpen] = useState(false)
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

    return skippedItemQueue.find((item) => item.itemId !== activeSkippedItemId && !answers[item.itemId]) ?? null
  }, [activeSkippedItemId, answers, skippedItemQueue])

  function startExam(mode: ExamMode = { kind: 'mixed' }) {
    if (screenTransition !== 'idle') {
      return
    }

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

    finishExamWithAnswers(answers)
  }

  function finishExamWithAnswers(finalAnswers: AnswerMap) {
    if (!session) {
      return
    }

    transitionToScreen(() => {
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
      setSession(null)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter('all')
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('home')
    })
  }

  function openHistory() {
    transitionToScreen(() => {
      setFilter('all')
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('history')
    })
  }

  function openSavedAttempt(attempt: SavedExamAttempt) {
    transitionToScreen(() => {
      setSession(attempt.session)
      setAnswers(attempt.answers)
      setSubmittedAnswers(attempt.answers)
      setFilter('all')
      setSkippedItemNotice(null)
      setSkippedItemQueue([])
      setActiveSkippedItemId(null)
      setExitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('results')
    })
  }

  function deleteExamHistory() {
    clearExamAttemptHistory()
    resetQuestionHistory()
    setSavedAttempts([])
    setAnsweredHistoryCount(0)
  }

  function addDummyHistory() {
    const dummyAttempts = createDummyExamHistory()
    writeExamAttemptHistory(dummyAttempts)
    setSavedAttempts(dummyAttempts)
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
            onChooseAnswer={chooseAnswer}
            onCloseImage={() => setExpandedImage(null)}
            onCancelExit={() => setExitNoticeOpen(false)}
            onCloseSkippedItems={() => setSkippedItemNotice(null)}
            onConfirmExit={confirmExitExam}
            onExit={exitExam}
            onGoToNextSkippedItem={goToNextSkippedItem}
            onOpenImage={setExpandedImage}
            onGoToSkippedItem={goToSkippedItem}
            onSubmit={submitExam}
            onSubmitAnyway={finishSubmitExam}
            nextSkippedItem={nextSkippedItem}
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
            onAddDummyHistory={addDummyHistory}
            onDeleteHistory={deleteExamHistory}
            onHome={goHome}
            onOpenAttempt={openSavedAttempt}
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
  onAddDummyHistory: () => void
  onDeleteHistory: () => void
  onHome: () => void
  onOpenAttempt: (attempt: SavedExamAttempt) => void
  theme: Theme
  onToggleTheme: () => void
}

function HistoryScreen({
  attempts,
  answeredHistoryCount,
  loadedQuestionCount,
  onAddDummyHistory,
  onDeleteHistory,
  onHome,
  onOpenAttempt,
  theme,
  onToggleTheme,
}: HistoryScreenProps) {
  const [selectedChartSubject, setSelectedChartSubject] = useState<Subject | null>(null)
  const aggregateStats = SUBJECTS.map<SubjectStat>((subject) =>
    attempts.reduce<SubjectStat>(
      (total, attempt) => {
        const subjectStat = attempt.subjectStats.find((stat) => stat.subject === subject)

        if (!subjectStat) {
          return total
        }

        return {
          subject,
          total: total.total + subjectStat.total,
          answered: total.answered + subjectStat.answered,
          correct: total.correct + subjectStat.correct,
        }
      },
      { subject, total: 0, answered: 0, correct: 0 },
    ),
  )
  const totalSavedItems = attempts.reduce((total, attempt) => total + attempt.totalQuestions, 0)
  const totalCorrect = attempts.reduce((total, attempt) => total + attempt.score, 0)
  const chartSeries = buildSubjectChartSeries(attempts)
  const visibleChartSeries = selectedChartSubject ? chartSeries.filter((series) => series.subject === selectedChartSubject) : chartSeries

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
          <button className="button button--ghost" onClick={onAddDummyHistory} type="button">
            Add dummy history
          </button>
          <button className="button button--danger" disabled={attempts.length === 0 && answeredHistoryCount === 0} onClick={onDeleteHistory} type="button">
            Delete history
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

      <section className="history-panel" aria-label="Subject statistics">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2>Subject stats</h2>
          </div>
        </div>
        <div className="subject-chart">
          <svg className="subject-chart__plot" viewBox="0 0 720 300" role="img" aria-label="Subject scores from zero to one hundred percent">
            {[0, 25, 50, 75, 100].map((tick) => {
              const y = 234 - (tick / 100) * 206

              return (
                <g key={tick}>
                  <line className="subject-chart__grid-line" x1="56" x2="676" y1={y} y2={y} />
                  <text className="subject-chart__axis-label" x="22" y={y + 4}>
                    {tick}%
                  </text>
                </g>
              )
            })}
            <line className="subject-chart__axis-line" x1="56" x2="676" y1="234" y2="234" />
            <line className="subject-chart__axis-line" x1="56" x2="56" y1="28" y2="234" />
            {attempts.length > 0 &&
              visibleChartSeries.map((series) => (
                <g key={series.subject}>
                  {series.points.length > 1 && (
                    <polyline
                      className="subject-chart__line"
                      points={series.points.map((point) => `${point.x},${point.y}`).join(' ')}
                      stroke={series.color}
                    />
                  )}
                  {series.points.map((point, index) => (
                    <circle className="subject-chart__point" cx={point.x} cy={point.y} fill={series.color} key={`${series.subject}-${index}`} r="3" />
                  ))}
                </g>
              ))}
            {attempts.length === 0 && (
              <g>
                <rect className="subject-chart__empty-backdrop" x="230" y="112" width="258" height="42" rx="8" />
                <text className="subject-chart__empty-label" x="359" y="138" textAnchor="middle">
                  No saved subject scores yet
                </text>
              </g>
            )}
          </svg>
          <div className="subject-chart__legend">
            {aggregateStats.map((stat) => (
              <button
                aria-pressed={selectedChartSubject === stat.subject}
                className={[
                  'subject-chart__legend-item',
                  selectedChartSubject === stat.subject ? 'subject-chart__legend-item--active' : '',
                  selectedChartSubject && selectedChartSubject !== stat.subject ? 'subject-chart__legend-item--muted' : '',
                ].filter(Boolean).join(' ')}
                key={stat.subject}
                onClick={() => setSelectedChartSubject((current) => (current === stat.subject ? null : stat.subject))}
                type="button"
              >
                <span className="subject-chart__swatch" style={{ backgroundColor: SUBJECT_CHART_COLORS[stat.subject] }} />
                <strong>{stat.subject}</strong>
                <span>{stat.total > 0 ? `${Math.round((stat.correct / stat.total) * 100)}%` : '0%'}</span>
                <small>
                  {stat.correct}/{stat.total} correct, {stat.answered} answered
                </small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="history-panel" aria-label="Submitted exams">
        <div className="section-heading">
          <div className="section-heading__title">
            <h2>Submitted exams</h2>
          </div>
        </div>

        {attempts.length === 0 ? (
          <p className="empty-history">No submitted exams saved yet.</p>
        ) : (
          <div className="attempt-list">
            {attempts.map((attempt) => (
              <button className="attempt-row" key={attempt.id} onClick={() => onOpenAttempt(attempt)} type="button">
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
  onCancelExit: () => void
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onCloseImage: () => void
  onCloseSkippedItems: () => void
  onConfirmExit: () => void
  onExit: () => void
  onGoToNextSkippedItem: () => void
  onGoToSkippedItem: (itemId: string) => void
  onOpenImage: (imageSrc: string) => void
  onSubmit: () => void
  onSubmitAnyway: () => void
  nextSkippedItem: SkippedItem | null
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
  onCancelExit,
  onChooseAnswer,
  onCloseImage,
  onCloseSkippedItems,
  onConfirmExit,
  onExit,
  onGoToNextSkippedItem,
  onGoToSkippedItem,
  onOpenImage,
  onSubmit,
  onSubmitAnyway,
  nextSkippedItem,
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
            onClick={onSubmit}
            type="button"
          >
            Submit Exam
          </button>
        </div>
      </header>

      <div className="question-list">
        {session.questions.map(({ id, itemNumber, question, choices }) => (
          <QuestionCard
            answers={answers}
            itemId={id}
            itemNumber={itemNumber}
            key={id}
            onChooseAnswer={onChooseAnswer}
            onOpenImage={onOpenImage}
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
  items: SkippedItem[]
  onDismiss: () => void
  onGoToItem: () => void
  onSubmitAnyway: () => void
}

function SkippedItemPanel({ items, onDismiss, onGoToItem, onSubmitAnyway }: SkippedItemPanelProps) {
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
          <div className="skipped-panel__actions">
            <button className="button button--primary" onClick={submitAnyway} type="button">
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
  question: ExamSession['questions'][number]['question']
}

function QuestionCard({
  answers,
  choices,
  itemId,
  itemNumber,
  onChooseAnswer,
  onOpenImage,
  question,
}: QuestionCardProps) {
  const markerChoicesOnly = Boolean(question.image) && usesImageChoiceMarkers(choices)
  const promptIsShownInImage = hasPromptInImage(question.id, question.image, markerChoicesOnly)

  return (
    <article className="question-card" id={`exam-item-${itemId}`}>
      <div className="question-card__top">
        <span className="question-number">Item {itemNumber}</span>
        <span className="subject-tag">{question.subject}</span>
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
