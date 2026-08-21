import { describe, expect, it, vi } from 'vitest'
import {
  bodyStateOptions,
  labelForAction,
  openAction,
  orderQuickPrompts,
  quickPrompts,
} from './lib/word-checklist'

describe('Word checklist UI contracts', () => {
  it('keeps eight quick prompts and sorts frequently used prompts first', () => {
    expect(quickPrompts).toHaveLength(8)
    expect(new Set(quickPrompts.map((prompt) => prompt.id)).size).toBe(8)

    const ordered = orderQuickPrompts({
      'guided-breathing': 4,
      'task-unmoving': 2,
    })
    expect(ordered.map(({ prompt }) => prompt.id).slice(0, 2)).toEqual([
      'guided-breathing',
      'task-unmoving',
    ])
  })

  it('offers fourteen built-in feeling choices without duplicates', () => {
    expect(bodyStateOptions).toHaveLength(14)
    expect(new Set(bodyStateOptions).size).toBe(14)
  })

  it('does not expose a navigation button until an offered action is confirmed', () => {
    const openView = vi.fn()

    expect(labelForAction('offer_breathing')).toBeNull()
    expect(labelForAction('offer_focus_timer')).toBeNull()
    expect(labelForAction('offer_daily_checkin')).toBeNull()
    openAction('offer_breathing', openView)
    expect(openView).not.toHaveBeenCalled()

    expect(labelForAction('open_breathing')).toBe('开始呼吸训练')
    openAction('open_breathing', openView)
    expect(openView).toHaveBeenCalledWith('breathing')
  })
})
