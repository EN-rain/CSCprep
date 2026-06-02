import { useEffect, useMemo, useRef, useState } from 'react'
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

type Screen = 'home' | 'exam' | 'results'
type Theme = 'light' | 'dark'
type ScreenTransition = 'idle' | 'content-exit' | 'content-enter'
const TIMED_EXAM_SECONDS = 60 * 60
const THEME_KEY = 'cscprep-theme'
const SCREEN_EXIT_MS = 240
const SCREEN_ENTER_MS = 360

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
])

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
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [skippedItemNotice, setSkippedItemNotice] = useState<SkippedItemNotice>(null)
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
      return
    }

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
      setSubmittedAnswers(finalAnswers)
      setAnsweredHistoryCount(getAnsweredHistoryCount())
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setScreen('results')
    })
  }

  function goToSkippedItem(itemId: string) {
    setSkippedItemNotice(null)

    window.setTimeout(() => {
      document.getElementById(`exam-item-${itemId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
  }

  function goHome() {
    transitionToScreen(() => {
      setSession(null)
      setAnswers({})
      setSubmittedAnswers({})
      setFilter('all')
      setSkippedItemNotice(null)
      setExitNoticeOpen(false)
      setExpandedImage(null)
      setScreen('home')
    })
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
      setExitNoticeOpen(false)
      setScreen('home')
    })
  }

  function resetHistory() {
    resetQuestionHistory()
    setAnsweredHistoryCount(0)
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
            loadedQuestionCount={loadedQuestionCount}
            onToggleTimer={toggleTimer}
            onResetHistory={resetHistory}
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
            onConfirmExit={confirmExitExam}
            onExit={exitExam}
            onOpenImage={setExpandedImage}
            onGoToSkippedItem={goToSkippedItem}
            onSubmit={submitExam}
            onSubmitAnyway={finishSubmitExam}
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
  loadedQuestionCount: number
  onResetHistory: () => void
  onStartExam: (mode?: ExamMode) => void
  onToggleTimer: () => void
  timerEnabled: boolean
  theme: Theme
  onToggleTheme: () => void
}

function HomeScreen({
  answeredHistoryCount,
  loadedQuestionCount,
  onResetHistory,
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
            <button className="button button--ghost button--compact" type="button" onClick={onResetHistory}>
              Reset History
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

type ExamScreenProps = {
  answeredCount: number
  answers: AnswerMap
  exitNoticeOpen: boolean
  expandedImage: string | null
  onCancelExit: () => void
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onCloseImage: () => void
  onConfirmExit: () => void
  onExit: () => void
  onGoToSkippedItem: (itemId: string) => void
  onOpenImage: (imageSrc: string) => void
  onSubmit: () => void
  onSubmitAnyway: () => void
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
  onConfirmExit,
  onExit,
  onGoToSkippedItem,
  onOpenImage,
  onSubmit,
  onSubmitAnyway,
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
          <article className="question-card" id={`exam-item-${id}`} key={id}>
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
                <img className="question-image" src={question.image} alt="Question reference" />
                <span className="question-image-hint">Click to enlarge</span>
              </button>
            )}
            <PromptText prompt={question.prompt} questionId={question.id} />
            <div className="choice-grid">
              {choices.map((choice, index) => {
                const isSelected = answers[id] === choice.id
                const displayLetter = String.fromCharCode(65 + index)

                return (
                  <button
                    aria-pressed={isSelected}
                    className={isSelected ? 'choice choice--selected' : 'choice'}
                    key={choice.id}
                    onClick={() => onChooseAnswer(id, choice.id)}
                    type="button"
                  >
                    <span>{displayLetter}</span>
                    {choice.text}
                  </button>
                )
              })}
            </div>
          </article>
        ))}
      </div>

      {unansweredCount > 0 && <p className="exam-footer-note">{unansweredCount} items left unanswered.</p>}

      {skippedItemNotice && (
        <SkippedItemPanel
          items={skippedItemNotice.items}
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

      <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />
    </section>
  )
}

type ExitExamPanelProps = {
  answeredCount: number
  onCancel: () => void
  onConfirm: () => void
}

function ExitExamPanel({ answeredCount, onCancel, onConfirm }: ExitExamPanelProps) {
  return (
    <div aria-modal="true" className="exam-dialog" role="dialog">
      <div className="exam-dialog__content" data-lenis-prevent>
        <p className="eyebrow">Exit exam</p>
        <h2>Leave this exam?</h2>
        <p className="exam-dialog__copy">
          {answeredCount > 0
            ? 'Answered items will be saved to the 2-take cooldown.'
            : 'You will return to the home screen.'}
        </p>
        <div className="exam-dialog__actions">
          <button className="button button--primary" onClick={onConfirm} type="button">
            Exit exam
          </button>
          <button className="button button--ghost" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

type SkippedItemPanelProps = {
  items: SkippedItem[]
  onGoToItem: () => void
  onSubmitAnyway: () => void
}

function SkippedItemPanel({ items, onGoToItem, onSubmitAnyway }: SkippedItemPanelProps) {
  const skippedLabel = items.length === 1 ? '1 item skipped' : `${items.length} items skipped`

  return (
    <div aria-modal="true" className="skipped-panel" role="dialog">
      <div className="skipped-panel__content" data-lenis-prevent>
        <p className="eyebrow">Skipped answer</p>
        <h2>{skippedLabel}</h2>
        <div className="skipped-panel__actions">
          <button className="button button--primary" onClick={onSubmitAnyway} type="button">
            Submit anyway
          </button>
          <button className="button button--ghost" onClick={onGoToItem} type="button">
            Go to item
          </button>
        </div>
      </div>
    </div>
  )
}

function formatBankProgress(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  }

  return String(value)
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
        <div>
          <span>{totalQuestions}</span>
          <p>total items</p>
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
          <article className="review-card" key={item.itemId}>
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
                <img className="question-image" src={item.image} alt="Question reference" />
                <span className="question-image-hint">Click to enlarge</span>
              </button>
            )}
            <PromptText prompt={item.prompt} questionId={item.questionId} />
            <div className="review-choices">
              {item.choices.map((choice, index) => {
                const isSelected = item.selectedChoiceId === choice.id
                const isCorrect = item.correctChoiceId === choice.id
                const className = [
                  'review-choice',
                  isCorrect ? 'review-choice--correct' : '',
                  isSelected && !isCorrect ? 'review-choice--wrong' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                const displayLetter = String.fromCharCode(65 + index)

                return (
                  <div className={className} key={choice.id}>
                    <span>{displayLetter}</span>
                    <p>{choice.text}</p>
                    {isSelected && <strong>Your answer</strong>}
                    {isCorrect && <strong>Correct</strong>}
                  </div>
                )
              })}
            </div>
            {item.explanation && <p className="explanation">{item.explanation}</p>}
          </article>
        ))}
      </div>

      <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />
    </section>
  )
}

type PromptTextProps = {
  prompt: string
  questionId: string
}

function PromptText({ prompt, questionId }: PromptTextProps) {
  if (PRESERVE_PROMPT_LINE_IDS.has(questionId)) {
    const lines = prompt.split('\n')

    return (
      <h2>
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
    return <h2>{prompt}</h2>
  }

  const lines = formatPromptLines(prompt)

  return (
    <h2>
      {lines.map((line, index) => (
        <span className="prompt-line" key={`${questionId}-${index}`}>
          {line}
        </span>
      ))}
    </h2>
  )
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
  imageSrc: string | null
  onClose: () => void
}

function ImageLightbox({ imageSrc, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!imageSrc) {
      return
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [imageSrc, onClose])

  if (!imageSrc) {
    return null
  }

  return (
    <div
      aria-modal="true"
      className="image-lightbox"
      data-lenis-prevent
      onClick={onClose}
      role="dialog"
    >
      <button
        aria-label="Close image preview"
        className="image-lightbox__close"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
      <div className="image-lightbox__content" onClick={(event) => event.stopPropagation()}>
        <img className="image-lightbox__image" src={imageSrc} alt="Expanded question reference" />
      </div>
    </div>
  )
}

export default App
