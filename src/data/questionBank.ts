import analyticalAbility from './analyticalAbility.json'
import cse2026 from './civil-service-exam-reviewer-for-2026.json'
import extra1 from './extra1.json'
import filipino from './filipino.json'
import generalInformation from './generalInformation.json'
import numericalReasoning from './numericalReasoning.json'
import verbalReasoning from './verbalReasoning.json'
import { type Question } from '../types'

export const questionBank: Question[] = [
  ...(verbalReasoning as Question[]),
  ...(numericalReasoning as Question[]),
  ...(analyticalAbility as Question[]),
  ...(filipino as Question[]),
  ...(generalInformation as Question[]),
  ...(cse2026 as Question[]),
  ...(extra1 as Question[]),
]

export const extra1Questions: Question[] = extra1 as Question[]

