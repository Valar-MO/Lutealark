import type { AppView } from '../store/app-store'

export type QuickPromptCounts = Record<string, number>

export const quickPrompts = [
  { id: 'task-stuck', emoji: '🌱', label: '有个任务启动不了', hint: '先找到最小一步', text: '有个任务启动不了' },
  { id: 'feeling-bothered', emoji: '🫧', label: '现在好烦', hint: '先让负担降一点', text: '现在好烦' },
  { id: 'feeling-crashed', emoji: '〰️', label: '崩溃了', hint: '先陪你稳住当下', text: '崩溃了' },
  { id: 'too-noisy', emoji: '🔈', label: '太吵了', hint: '降低一点环境刺激', text: '太吵了' },
  { id: 'hard-week', emoji: '🌙', label: '这周难熬', hint: '把这一段变轻一点', text: '这周难熬' },
  { id: 'guided-breathing', emoji: '🌬️', label: '带我呼吸', hint: '一起做几分钟练习', text: '带我呼吸' },
  { id: 'thanks', emoji: '🌿', label: '谢谢', hint: '我会把这份感受接住', text: '谢谢' },
  { id: 'task-unmoving', emoji: '🧩', label: '任务做不动', hint: '把动作再缩小一点', text: '任务做不动' },
] as const

export const bodyStateOptions = [
  '疲惫', '睡不好', '疼痛', '注意力飘', '头痛', '腹胀', '腰酸',
  '胸胀', '食欲变化', '情绪敏感', '身体紧绷', '恶心', '手脚冰凉', '精力不错',
] as const

export function orderQuickPrompts(counts: QuickPromptCounts) {
  return quickPrompts
    .map((prompt, originalIndex) => ({ prompt, originalIndex }))
    .sort((left, right) => (counts[right.prompt.id] ?? 0) - (counts[left.prompt.id] ?? 0) || left.originalIndex - right.originalIndex)
}

export function labelForAction(action: string) {
  if (action === 'open_breathing') return '开始呼吸训练'
  if (action === 'open_pomodoro' || action === 'open_focus_timer') return '打开轻专注计时'
  if (action === 'open_light_plan') return '打开今日轻计划'
  if (action === 'open_environment_reset' || action === 'show_environment_reset') return '看看环境降载建议'
  if (action === 'open_micro_movement' || action === 'show_micro_movement') return '开始一次微运动'
  if (action === 'open_daily_checkin') return '记录今天的状态'
  if (action === 'open_cycle') return '查看周期状态'
  return null
}

export function openAction(action: string, openView: (view: AppView, search?: string) => void) {
  if (action === 'open_breathing') return openView('breathing')
  if (action === 'open_daily_checkin') return openView('cycle', '?section=checkin')
  if (action === 'open_cycle') return openView('cycle')
  if (action === 'open_pomodoro' || action === 'open_focus_timer') return openView('tools', '?tool=focus')
  if (action === 'open_light_plan') return openView('tools', '?tool=plan')
  if (action === 'open_environment_reset' || action === 'show_environment_reset') return openView('tools', '?tool=environment')
  if (action === 'open_micro_movement' || action === 'show_micro_movement') return openView('tools', '?tool=movement')
}
