import { Layer } from 'effect'
import { PatientRepository } from './patient-repository.ts'
import { seedChart } from './seed.ts'

/** 가상 환자 시드를 넣는 테스트 setup. */
export const SeededChart = Layer.effectDiscard(seedChart).pipe(Layer.provide(PatientRepository.layer))
