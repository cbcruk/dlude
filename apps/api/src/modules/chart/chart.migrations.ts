import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Migrations } from '../../shared/db/migrations.ts'

/** Chart(InternalChart) 표. 번호 0003은 이 컨텍스트 몫이다(shared/db/migrations.ts). 주민등록번호 열은 없다. */
export const chartMigrations: Migrations = {
  '0003_chart': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE chart_patients (
        id TEXT PRIMARY KEY,
        chart_number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_folded TEXT NOT NULL,
        name_initials TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        sex TEXT NOT NULL CHECK (sex IN ('F', 'M')),
        phone TEXT NOT NULL,
        phone_digits TEXT NOT NULL,
        synthetic INTEGER NOT NULL CHECK (synthetic IN (0, 1))
      ) STRICT
    `
    yield* sql`CREATE INDEX chart_patients_name ON chart_patients (name, id)`
    yield* sql`
      CREATE TABLE chart_procedure_codes (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT
    `
    yield* sql`
      CREATE TABLE chart_appointments (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES chart_patients (id),
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        procedure_code TEXT NOT NULL REFERENCES chart_procedure_codes (code),
        status TEXT NOT NULL CHECK (status IN ('BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'))
      ) STRICT
    `
    yield* sql`CREATE INDEX chart_appointments_starts_at ON chart_appointments (starts_at)`
    yield* sql`
      CREATE TABLE chart_treatment_plans (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES chart_patients (id),
        created_on TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PROPOSED', 'ACCEPTED', 'COMPLETED')),
        procedure_codes TEXT NOT NULL
      ) STRICT
    `
    yield* sql`CREATE INDEX chart_treatment_plans_patient ON chart_treatment_plans (patient_id)`
  }),
}
