import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { PatientRow } from './use-patient-list'

const SEX = { F: '여', M: '남' } as const

export function PatientTable({ items }: { items: ReadonlyArray<PatientRow> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>차트번호</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>생년월일</TableHead>
          <TableHead>성별</TableHead>
          <TableHead>전화 뒤 4자리</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((patient) => (
          <TableRow key={patient.id}>
            <TableCell className="tabular-nums">{patient.chartNumber}</TableCell>
            <TableCell>{patient.name}</TableCell>
            <TableCell className="tabular-nums">{patient.birthDate}</TableCell>
            <TableCell>{SEX[patient.sex]}</TableCell>
            <TableCell className="tabular-nums">{patient.phoneLast4}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
