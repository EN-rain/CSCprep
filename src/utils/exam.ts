import { questionBank } from '../data/questionBank'
import {
  SUBJECTS,
  type AnswerMap,
  type ExamMode,
  type ExamQuestion,
  type ExamSession,
  type Question,
  type QuestionHistory,
  type QuestionHistoryEntry,
  type Subject,
} from '../types'

const HISTORY_KEY = 'cscprep:question-history:v1'
const COMPLETED_EXAM_COUNT_KEY = 'cscprep:completed-exam-count:v1'
const ITEMS_PER_SUBJECT = 20
const TOTAL_EXAM_ITEMS = 100
const COOLDOWN_EXAMS = 2

function isExamEligibleQuestion(question: Question): boolean {
  return Boolean(question.prompt && question.choices.length >= 2)
}

function getExamEligibleQuestions(): Question[] {
  return questionBank.filter(isExamEligibleQuestion)
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }

  return copy
}

function byLeastRecentCooldown(a: QuestionHistoryEntry, b: QuestionHistoryEntry): number {
  return (
    a.eligibleAgainAfterExamNumber - b.eligibleAgainAfterExamNumber ||
    a.lastAnsweredExamNumber - b.lastAnsweredExamNumber
  )
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function getCompletedExamCount(): number {
  const value = Number(window.localStorage.getItem(COMPLETED_EXAM_COUNT_KEY))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function setCompletedExamCount(count: number): void {
  window.localStorage.setItem(COMPLETED_EXAM_COUNT_KEY, String(count))
}

export function getQuestionHistory(): QuestionHistory {
  return readJson<QuestionHistory>(HISTORY_KEY, {})
}

function saveQuestionHistory(history: QuestionHistory): void {
  writeJson(HISTORY_KEY, history)
}

export function resetQuestionHistory(): void {
  window.localStorage.removeItem(HISTORY_KEY)
  window.localStorage.removeItem(COMPLETED_EXAM_COUNT_KEY)
}

function questionsBySubject(subject: Subject): Question[] {
  return getExamEligibleQuestions().filter((question) => question.subject === subject)
}

function pickQuestions(
  questions: Question[],
  history: QuestionHistory,
  examNumber: number,
  targetCount: number,
  excludedQuestionIds = new Set<string>(),
): Question[] {
  const availableQuestions = questions.filter((question) => !excludedQuestionIds.has(question.id))
  const eligible = availableQuestions.filter((question) => {
    const entry = history[question.id]
    return !entry || examNumber > entry.eligibleAgainAfterExamNumber
  })
  const coolingDown = availableQuestions
    .filter((question) => !eligible.includes(question))
    .sort((a, b) => byLeastRecentCooldown(history[a.id], history[b.id]))

  return [
    ...shuffle(eligible).slice(0, targetCount),
    ...coolingDown.slice(0, Math.max(0, targetCount - eligible.length)),
  ].slice(0, targetCount)
}

function pickSubjectQuestions(
  subject: Subject,
  history: QuestionHistory,
  examNumber: number,
  targetCount: number,
): Question[] {
  return pickQuestions(questionsBySubject(subject), history, examNumber, targetCount)
}

function getSessionTitle(mode: ExamMode): string {
  return mode.kind === 'mixed' ? 'Random Exam' : `${mode.subject} Exam`
}

export function createExamSession(mode: ExamMode = { kind: 'mixed' }, timed = false): ExamSession {
  const history = getQuestionHistory()
  const examNumber = getCompletedExamCount() + 1

  const questions =
    mode.kind === 'mixed'
      ? pickQuestions(getExamEligibleQuestions(), history, examNumber, TOTAL_EXAM_ITEMS)
      : pickSubjectQuestions(mode.subject, history, examNumber, TOTAL_EXAM_ITEMS)

  return {
    examNumber,
    mode,
    title: getSessionTitle(mode),
    timed,
    questions: shuffle(questions).map<ExamQuestion>((question, index) => ({
      id: `${question.id}-${index + 1}`,
      itemNumber: index + 1,
      question,
      choices: shuffle(question.choices),
    })),
  }
}

export function completeExam(session: ExamSession, answers: AnswerMap): void {
  const history = getQuestionHistory()

  session.questions.forEach(({ id, question }) => {
    if (!answers[id]) {
      return
    }

    history[question.id] = {
      questionId: question.id,
      lastAnsweredExamNumber: session.examNumber,
      eligibleAgainAfterExamNumber: session.examNumber + COOLDOWN_EXAMS,
    }
  })

  saveQuestionHistory(history)
  setCompletedExamCount(Math.max(getCompletedExamCount(), session.examNumber))
}

export function countSubjectQuestions(): Record<Subject, number> {
  return SUBJECTS.reduce(
    (counts, subject) => ({
      ...counts,
      [subject]: questionsBySubject(subject).length,
    }),
    {} as Record<Subject, number>,
  )
}

export function getAnsweredHistoryCount(): number {
  return Object.keys(getQuestionHistory()).length
}

export function getLoadedQuestionCount(): number {
  return getExamEligibleQuestions().length
}

export { COOLDOWN_EXAMS, ITEMS_PER_SUBJECT, TOTAL_EXAM_ITEMS }
