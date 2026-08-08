import { extra1Questions, questionBank } from '../data/questionBank'
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
const RANDOM_EXAM_ITEMS = 999
const MAX_EXAM_ITEMS = 999
const COOLDOWN_EXAMS = 2
const MIXED_EXAM_SUBJECT_COUNTS: Partial<Record<Subject, number>> = {
  'Verbal Reasoning': 40,
  'Analytical Ability': 25,
  'Numerical Reasoning': 25,
  'General Information': 10,
  Filipino: 10,
}

function isExamEligibleQuestion(question: Question): boolean {
  if (question.status === 'excluded' || question.status === 'needs-review') {
    return false
  }

  const hasPlaceholderChoices = question.choices.some((choice) => {
    const text = choice.text.trim()
    return !text || /^Option [A-E]$/.test(text) || /^Choice [A-E]$/.test(text)
  })

  const hasCorrectChoice = question.choices.some((choice) => choice.id === question.correctChoiceId)

  return Boolean(
    question.prompt.trim() &&
    question.choices.length >= 2 &&
    !hasPlaceholderChoices &&
    hasCorrectChoice
  )
}

function normalizePromptForDedupe(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    
}

function getExamEligibleQuestions(): Question[] {
  const eligible = questionBank.filter(isExamEligibleQuestion)
  // Prefer older subject banks over cse2026 duplicates of the same stem.
  const preferredByPrompt = new Map<string, Question>()
  for (const question of eligible) {
    const key = normalizePromptForDedupe(question.prompt)
    if (key.length < 25) {
      // Short stems (sequences, single-word items) are often legitimately unique.
      continue
    }
    const existing = preferredByPrompt.get(key)
    if (!existing) {
      preferredByPrompt.set(key, question)
      continue
    }
    const existingIsCse = existing.id.startsWith('cse2026-')
    const candidateIsCse = question.id.startsWith('cse2026-')
    if (existingIsCse && !candidateIsCse) {
      preferredByPrompt.set(key, question)
    }
  }
  const suppressed = new Set<string>()
  for (const question of eligible) {
    const key = normalizePromptForDedupe(question.prompt)
    if (key.length < 25) continue
    const preferred = preferredByPrompt.get(key)
    if (preferred && preferred.id !== question.id && question.id.startsWith('cse2026-')) {
      suppressed.add(question.id)
    }
  }
  return eligible.filter((question) => !suppressed.has(question.id))
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

type QuestionUnit = {
  /** Stable key for shuffle; passage id or single question id. */
  key: string
  questions: Question[]
}

function isQuestionEligibleNow(
  question: Question,
  history: QuestionHistory,
  examNumber: number,
): boolean {
  const entry = history[question.id]
  return !entry || examNumber > entry.eligibleAgainAfterExamNumber
}

/** Group shared-passage items into ordered chains; leave standalones alone. */
function buildQuestionUnits(questions: Question[]): QuestionUnit[] {
  const byPassage = new Map<string, Question[]>()
  const standalones: Question[] = []

  for (const question of questions) {
    if (question.passageId) {
      const list = byPassage.get(question.passageId) ?? []
      list.push(question)
      byPassage.set(question.passageId, list)
    } else {
      standalones.push(question)
    }
  }

  const units: QuestionUnit[] = []

  for (const [passageId, members] of byPassage) {
    const ordered = [...members].sort(
      (a, b) => (a.passageOrder ?? 0) - (b.passageOrder ?? 0) || a.id.localeCompare(b.id),
    )
    units.push({ key: passageId, questions: ordered })
  }

  for (const question of standalones) {
    units.push({ key: question.id, questions: [question] })
  }

  return units
}

function unitIsEligible(unit: QuestionUnit, history: QuestionHistory, examNumber: number): boolean {
  // Whole chain is eligible only if every member is eligible (keeps set intact).
  return unit.questions.every((q) => isQuestionEligibleNow(q, history, examNumber))
}

function unitCooldownScore(unit: QuestionUnit, history: QuestionHistory): number {
  let maxEligible = 0
  for (const q of unit.questions) {
    const entry = history[q.id]
    if (entry) {
      maxEligible = Math.max(maxEligible, entry.eligibleAgainAfterExamNumber)
    }
  }
  return maxEligible
}

function pickQuestions(
  questions: Question[],
  history: QuestionHistory,
  examNumber: number,
  targetCount: number,
  excludedQuestionIds = new Set<string>(),
): Question[] {
  const availableQuestions = questions.filter((question) => !excludedQuestionIds.has(question.id))
  const units = buildQuestionUnits(availableQuestions)

  const eligibleUnits = units.filter((unit) => unitIsEligible(unit, history, examNumber))
  const coolingUnits = units
    .filter((unit) => !eligibleUnits.includes(unit))
    .sort((a, b) => unitCooldownScore(a, history) - unitCooldownScore(b, history))

  const picked: Question[] = []
  const tryTake = (pool: QuestionUnit[]) => {
    for (const unit of shuffle(pool)) {
      if (picked.length >= targetCount) break
      const size = unit.questions.length
      // Never split a passage chain: only take it if it fits fully.
      if (picked.length + size > targetCount) continue
      picked.push(...unit.questions)
    }
  }

  tryTake(eligibleUnits)
  if (picked.length < targetCount) {
    tryTake(coolingUnits)
  }

  return picked.slice(0, targetCount)
}

/** Shuffle exam order by unit so passage chains stay consecutive. */
function shufflePreservingChains(questions: Question[]): Question[] {
  const units = buildQuestionUnits(questions)
  return shuffle(units).flatMap((unit) => unit.questions)
}

function getSessionTitle(mode: ExamMode): string {
  if (mode.kind === 'mixed') {
    return 'Random Exam'
  }

  if (mode.kind === 'extra') {
    if (mode.extraId === 'extra1') return 'Extra 1 (150 Items)'
    return 'Extra Exam'
  }

  return `${mode.subject} Exam`
}

function isOrderSensitiveChoiceText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return (
    /both\s*a\s*and\s*b/.test(normalized) ||
    /neither\s*a\s*nor\s*b/.test(normalized) ||
    /all of the above/.test(normalized) ||
    /none of the above/.test(normalized) ||
    /statement\s*\(?\s*1\s*\)?/.test(normalized) ||
    /statement\s*\(?\s*2\s*\)?/.test(normalized) ||
    /each statement alone is sufficient/.test(normalized) ||
    /both statements together are sufficient/.test(normalized) ||
    /statements together are not sufficient/.test(normalized)
  )
}

function preservesChoiceOrder(question: Question): boolean {
  if (question.image || question.choices.some((choice) => Boolean(choice.image))) {
    return true
  }

  // Keep lettered references and standard data-sufficiency stems fixed so
  // "both A and B" / "statement (1) alone" stay meaningful after load.
  return question.choices.some((choice) => isOrderSensitiveChoiceText(choice.text || ''))
}

function allocateProportionately(itemCount: number, subjectCounts: Record<Subject, number>): Record<Subject, number> {
  const total = Object.values(subjectCounts).reduce((a, b) => a + b, 0)
  if (total === 0) {
    return SUBJECTS.reduce((acc, sub) => ({ ...acc, [sub]: 0 }), {} as Record<Subject, number>)
  }

  const allocations: Record<Subject, number> = {} as Record<Subject, number>
  let allocatedSum = 0
  const remainders: { subject: Subject; remainder: number }[] = []

  SUBJECTS.forEach((subject) => {
    const count = subjectCounts[subject] ?? 0
    const exact = (count / total) * itemCount
    const floor = Math.floor(exact)
    allocations[subject] = floor
    allocatedSum += floor
    remainders.push({ subject, remainder: exact - floor })
  })

  remainders.sort((a, b) => b.remainder - a.remainder)

  let index = 0
  while (allocatedSum < itemCount && index < remainders.length) {
    const sub = remainders[index].subject
    allocations[sub] += 1
    allocatedSum += 1
    index += 1
  }

  if (allocatedSum < itemCount) {
    for (const sub of SUBJECTS) {
      const limit = subjectCounts[sub] ?? 0
      while (allocations[sub] < limit && allocatedSum < itemCount) {
        allocations[sub] += 1
        allocatedSum += 1
      }
    }
  }

  return allocations
}

export function createExamSession(mode: ExamMode = { kind: 'mixed' }, timed = false): ExamSession {
  return createExamSessionWithExclusions(mode, timed)
}

export function createExamSessionWithExclusions(
  mode: ExamMode = { kind: 'mixed' },
  timed = false,
  excludedQuestionIds = new Set<string>(),
): ExamSession {
  const history = getQuestionHistory()
  const examNumber = getCompletedExamCount() + 1
  const allEligibleQuestions = getExamEligibleQuestions()

  const questions = (() => {
    if (mode.kind === 'extra') {
      // Fixed ordered set for Extra exams (no random pick / no shuffle of item order)
      const source = mode.extraId === 'extra1' ? extra1Questions : []
      return source.filter((q) => q.status !== 'excluded')
    }

    if (mode.kind === 'mixed') {
      const itemCount = Math.min(
        Math.max(1, Math.floor(mode.itemCount ?? RANDOM_EXAM_ITEMS)),
        MAX_EXAM_ITEMS,
        allEligibleQuestions.length,
      )
      const allocations = allocateProportionately(itemCount, MIXED_EXAM_SUBJECT_COUNTS as Record<Subject, number>)
      const selectedQuestionIds = new Set<string>()

      return SUBJECTS.flatMap((subject) => {
        const targetCount = allocations[subject] ?? 0

        if (targetCount === 0) {
          return []
        }

        const subjectQuestions = pickQuestions(
          questionsBySubject(subject),
          history,
          examNumber,
          targetCount,
          new Set([...selectedQuestionIds, ...excludedQuestionIds]),
        )

        subjectQuestions.forEach((question) => selectedQuestionIds.add(question.id))
        return subjectQuestions
      })
    }

    const subjectQuestionCount = Math.min(
      Math.max(1, Math.floor(mode.itemCount ?? TOTAL_EXAM_ITEMS)),
      MAX_EXAM_ITEMS,
      questionsBySubject(mode.subject).length,
    )

    return pickQuestions(questionsBySubject(mode.subject), history, examNumber, subjectQuestionCount, excludedQuestionIds)
  })()
  const orderedQuestions = mode.kind === 'extra'
    ? questions
    : shufflePreservingChains(questions)

  return {
    examNumber,
    mode,
    title: getSessionTitle(mode),
    timed,
    questions: orderedQuestions.map<ExamQuestion>((question, index) => ({
      id: `${question.id}-${index + 1}`,
      itemNumber: index + 1,
      question,
      choices: preservesChoiceOrder(question) ? question.choices : shuffle(question.choices),
    })),
  }
}

function replacementPoolForQuestion(session: ExamSession, targetQuestion: Question): Question[] {
  if (session.mode.kind === 'subject') {
    return questionsBySubject(session.mode.subject)
  }

  const sameSubjectPool = questionsBySubject(targetQuestion.subject)
  return sameSubjectPool.length > 0 ? sameSubjectPool : getExamEligibleQuestions()
}

export function replaceExamQuestion(
  session: ExamSession,
  itemId: string,
  excludedQuestionIds = new Set<string>(),
): ExamSession {
  const targetItem = session.questions.find((question) => question.id === itemId)

  if (!targetItem) {
    return session
  }

  const excludedIds = new Set([
    ...session.questions.map((question) => question.question.id),
    ...excludedQuestionIds,
  ])
  const history = getQuestionHistory()
  const replacementPool = replacementPoolForQuestion(session, targetItem.question)
  const candidates = replacementPool.filter((question) => !excludedIds.has(question.id))
  const eligibleCandidates = candidates.filter((question) => {
    const entry = history[question.id]
    return !entry || session.examNumber > entry.eligibleAgainAfterExamNumber
  })
  const fallbackCandidates = candidates
    .filter((question) => !eligibleCandidates.includes(question))
    .sort((a, b) => byLeastRecentCooldown(history[a.id], history[b.id]))
  const replacementQuestion = shuffle(eligibleCandidates)[0] ?? fallbackCandidates[0]

  if (!replacementQuestion) {
    return session
  }

  const replacementChoices = preservesChoiceOrder(replacementQuestion)
    ? replacementQuestion.choices
    : shuffle(replacementQuestion.choices)

  return {
    ...session,
    questions: session.questions.map((question) => (
      question.id === itemId
        ? {
            ...question,
            question: replacementQuestion,
            choices: replacementChoices,
          }
        : question
    )),
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
  const questionIds = new Set(getExamEligibleQuestions().map((question) => question.id))

  return Object.keys(getQuestionHistory()).filter((questionId) => questionIds.has(questionId)).length
}

export function getLoadedQuestionCount(): number {
  return getExamEligibleQuestions().length
}

export { COOLDOWN_EXAMS, ITEMS_PER_SUBJECT, MAX_EXAM_ITEMS, MIXED_EXAM_SUBJECT_COUNTS, RANDOM_EXAM_ITEMS, TOTAL_EXAM_ITEMS }
