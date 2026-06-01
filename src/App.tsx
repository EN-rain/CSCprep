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
const TIMED_EXAM_SECONDS = 60 * 60

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

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [session, setSession] = useState<ExamSession | null>(null)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [submittedAnswers, setSubmittedAnswers] = useState<AnswerMap>({})
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(TIMED_EXAM_SECONDS)
  const [answeredHistoryCount, setAnsweredHistoryCount] = useState(() => getAnsweredHistoryCount())
  const [loadedQuestionCount] = useState(() => getLoadedQuestionCount())

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
        ? 'Exit exam? Answered items will be saved to the 5-take cooldown.'
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

  return (
    <main className="app-shell">
      {screen === 'home' && (
        <HomeScreen
          answeredHistoryCount={answeredHistoryCount}
          loadedQuestionCount={loadedQuestionCount}
          onToggleTimer={toggleTimer}
          onResetHistory={resetHistory}
          onStartExam={startExam}
          timerEnabled={timerEnabled}
        />
      )}

      {screen === 'exam' && session && (
        <ExamScreen
          answeredCount={answeredCount}
          answers={answers}
          onChooseAnswer={chooseAnswer}
          onExit={exitExam}
          onSubmit={submitExam}
          progressPercent={progressPercent}
          remainingSeconds={remainingSeconds}
          session={session}
          totalQuestions={totalQuestions}
        />
      )}

      {screen === 'results' && session && (
        <ResultsScreen
          filter={filter}
          filteredReviewItems={filteredReviewItems}
          onFilterChange={setFilter}
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

type HomeScreenProps = {
  answeredHistoryCount: number
  loadedQuestionCount: number
  onResetHistory: () => void
  onStartExam: (mode?: ExamMode) => void
  onToggleTimer: () => void
  timerEnabled: boolean
}

function HomeScreen({
  answeredHistoryCount,
  loadedQuestionCount,
  onResetHistory,
  onStartExam,
  onToggleTimer,
  timerEnabled,
}: HomeScreenProps) {
  return (
    <section className="home">
      <div className="home__content">
        <div>
          <p className="eyebrow">Civil Service Exam Practice</p>
          <h1>CSCprep</h1>
          <p className="tagline">Practice with anonymous 100-item exams, subject drills, instant results, and local cooldown tracking.</p>
        </div>
        <span className="history-indicator history-indicator--hero">
          Answered {formatBankProgress(answeredHistoryCount)}/{formatBankProgress(loadedQuestionCount)}
        </span>
      </div>

      <section className="start-panel" aria-label="Start an exam">
        <div className="section-heading">
          <h2>Choose an exam</h2>
          <div className="history-tools">
            <button className="button button--ghost button--compact" type="button" onClick={onToggleTimer}>
              {timerEnabled ? 'With Timer' : 'No Timer'}
            </button>
            <button className="button button--ghost button--compact" type="button" onClick={onResetHistory}>
              Reset History
            </button>
          </div>
        </div>
        <div className="start-grid">
          <button
            className="start-option start-option--primary"
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
  onChooseAnswer: (itemId: string, choiceId: ChoiceId) => void
  onExit: () => void
  onSubmit: () => void
  progressPercent: number
  remainingSeconds: number
  session: ExamSession
  totalQuestions: number
}

function ExamScreen({
  answeredCount,
  answers,
  onChooseAnswer,
  onExit,
  onSubmit,
  progressPercent,
  remainingSeconds,
  session,
  totalQuestions,
}: ExamScreenProps) {
  const unansweredCount = totalQuestions - answeredCount

  return (
    <section className="exam">
      <header className="exam-header">
        <div>
          <p className="eyebrow">Exam try #{session.examNumber}</p>
          <h1>{session.title}</h1>
        </div>
        <div className="progress-copy">
          {session.timed && <span className="timer-pill">{formatTimer(remainingSeconds)}</span>}
          <strong>
            {answeredCount}/{totalQuestions}
          </strong>
          <span>answered</span>
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
            {question.image && <img className="question-image" src={question.image} alt="" />}
            <h2>{question.prompt}</h2>
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

      <footer className="submit-bar">
        <p>{unansweredCount === 0 ? 'Ready to submit.' : `${unansweredCount} items left unanswered.`}</p>
        <div className="submit-actions">
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
      </footer>
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
  filter: ReviewFilter
  filteredReviewItems: ReviewItem[]
  onFilterChange: (filter: ReviewFilter) => void
  onRetake: () => void
  passed: boolean
  percentage: number
  reviewItems: ReviewItem[]
  score: number
  totalQuestions: number
}

function ResultsScreen({
  filter,
  filteredReviewItems,
  onFilterChange,
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
            {item.image && <img className="question-image" src={item.image} alt="" />}
            <h2>{item.prompt}</h2>
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
    </section>
  )
}

export default App
