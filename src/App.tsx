import { useEffect, useMemo, useState } from 'react'
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
const TIMED_EXAM_SECONDS = 60 * 60
const THEME_KEY = 'cscprep-theme'

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

  const totalQuestions = session?.questions.length ?? 0
  const answeredCount = Object.keys(answers).length
  const progressPercent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0

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
    const nextSession = createExamSession(mode, timerEnabled)
    setSession(nextSession)
    setAnswers({})
    setSubmittedAnswers({})
    setFilter('all')
    setRemainingSeconds(TIMED_EXAM_SECONDS)
    setScreen('exam')
  }

  function chooseAnswer(questionId: string, choiceId: ChoiceId) {
    setAnswers((current) => ({
      ...current,
      [questionId]: choiceId,
    }))
  }

  function submitExam() {
    if (!session || answeredCount !== totalQuestions) {
      return
    }

    completeExam(session, answers)
    setSubmittedAnswers(answers)
    setAnsweredHistoryCount(getAnsweredHistoryCount())
    setScreen('results')
  }

  function exitExam() {
    if (!session) {
      return
    }

    const message =
      answeredCount > 0
        ? 'Exit exam? Answered items will be saved to the 2-take cooldown.'
        : 'Exit exam and return home?'

    if (!window.confirm(message)) {
      return
    }

    if (answeredCount > 0) {
      completeExam(session, answers)
      setAnsweredHistoryCount(getAnsweredHistoryCount())
    }

    setSession(null)
    setAnswers({})
    setSubmittedAnswers({})
    setFilter('all')
    setScreen('home')
  }

  function resetHistory() {
    resetQuestionHistory()
    setAnsweredHistoryCount(0)
  }

  function toggleTimer() {
    setTimerEnabled((current) => !current)
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
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  function toggleTheme() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }

  return (
    <main className="app-shell">
      {screen === 'results' && (
        <div className="app-toolbar">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      )}
      {screen === 'home' && (
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
      )}

      {screen === 'exam' && session && (
        <ExamScreen
          answeredCount={answeredCount}
          answers={answers}
          expandedImage={expandedImage}
          onChooseAnswer={chooseAnswer}
          onCloseImage={() => setExpandedImage(null)}
          onExit={exitExam}
          onOpenImage={setExpandedImage}
          onSubmit={submitExam}
          progressPercent={progressPercent}
          remainingSeconds={remainingSeconds}
          session={session}
          theme={theme}
          totalQuestions={totalQuestions}
          onToggleTheme={toggleTheme}
        />
      )}

      {screen === 'results' && session && (
        <ResultsScreen
          expandedImage={expandedImage}
          filter={filter}
          filteredReviewItems={filteredReviewItems}
          onFilterChange={setFilter}
          onCloseImage={() => setExpandedImage(null)}
          onOpenImage={setExpandedImage}
          onRetake={() => startExam(session.mode)}
          passed={passed}
          percentage={percentage}
          reviewItems={reviewItems}
          score={score}
          totalQuestions={totalQuestions}
        />
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
  expandedImage: string | null
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onCloseImage: () => void
  onExit: () => void
  onOpenImage: (imageSrc: string) => void
  onSubmit: () => void
  progressPercent: number
  remainingSeconds: number
  session: ExamSession
  theme: Theme
  totalQuestions: number
  onToggleTheme: () => void
}

function ExamScreen({
  answeredCount,
  answers,
  expandedImage,
  onChooseAnswer,
  onCloseImage,
  onExit,
  onOpenImage,
  onSubmit,
  progressPercent,
  remainingSeconds,
  session,
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
            disabled={unansweredCount > 0}
            onClick={onSubmit}
            type="button"
          >
            Submit Exam
          </button>
        </div>
      </header>

      <div className="progress-track" aria-label={`${progressPercent}% answered`}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="question-list">
        {session.questions.map(({ id, itemNumber, question, choices }) => (
          <article className="question-card" key={id}>
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

      <ImageLightbox imageSrc={expandedImage} onClose={onCloseImage} />
    </section>
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
  onRetake: () => void
  passed: boolean
  percentage: number
  reviewItems: ReviewItem[]
  score: number
  totalQuestions: number
}

function ResultsScreen({
  expandedImage,
  filter,
  filteredReviewItems,
  onFilterChange,
  onCloseImage,
  onOpenImage,
  onRetake,
  passed,
  percentage,
  reviewItems,
  score,
  totalQuestions,
}: ResultsScreenProps) {
  const correctCount = reviewItems.filter((item) => item.isCorrect).length
  const wrongCount = reviewItems.length - correctCount

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
        <button className="button button--primary" onClick={onRetake} type="button">
          Retake Exam
        </button>
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
    <div aria-modal="true" className="image-lightbox" onClick={onClose} role="dialog">
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
