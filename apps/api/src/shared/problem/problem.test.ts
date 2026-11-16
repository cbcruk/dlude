import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Internal, NotFound, problemType } from './problem.ts'

describe('problemType', () => {
  it('오류 코드를 dlude problem URN으로 바꾼다', () => {
    expect(problemType('TOTP_REQUIRED_FOR_ROLE')).toBe('urn:dlude:problem:totp-required-for-role')
  })
})

describe('NotFound', () => {
  it('RFC 9457 필드로 인코딩하고 빈 선택 필드는 뺀다', () => {
    expect(Schema.encodeSync(NotFound)(new NotFound({}))).toEqual({
      type: 'urn:dlude:problem:not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('Internal', () => {
  it('본문에 원인 필드가 없다(P5)', () => {
    expect(Object.keys(Schema.encodeSync(Internal)(new Internal({}))).sort()).toEqual([
      'code',
      'status',
      'title',
      'type',
    ])
  })
})
