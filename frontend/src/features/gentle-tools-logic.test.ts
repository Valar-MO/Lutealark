import { describe, expect, it } from 'vitest'
import {
  addGentlePlanItem,
  formatCountdown,
  normalizeGentlePlan,
  toggleGentlePlanItem,
} from './gentle-tools-logic'

describe('gentle tool logic', () => {
  it('keeps a lightweight plan trimmed, unique and limited to three items', () => {
    const result = normalizeGentlePlan([
      { id: 'one', text: '  打开文档  ', completed: false },
      { id: 'one', text: '重复', completed: true },
      { id: 'two', text: '写标题', completed: false },
      { id: 'three', text: '找一篇资料', completed: false },
      { id: 'four', text: '不会加入', completed: false },
    ])

    expect(result).toEqual([
      { id: 'one', text: '打开文档', completed: false },
      { id: 'two', text: '写标题', completed: false },
      { id: 'three', text: '找一篇资料', completed: false },
    ])
  })

  it('adds and completes a stable plan item without adding a fourth item', () => {
    const first = addGentlePlanItem([], '打开文档', 'stable-id')
    expect(toggleGentlePlanItem(first, 'stable-id')[0]?.completed).toBe(true)
    const full = [
      ...first,
      { id: 'two', text: '写标题', completed: false },
      { id: 'three', text: '找资料', completed: false },
    ]
    expect(addGentlePlanItem(full, '第四项', 'four')).toHaveLength(3)
  })

  it('formats a safe countdown', () => {
    expect(formatCountdown(65)).toBe('01:05')
    expect(formatCountdown(-4)).toBe('00:00')
  })
})
