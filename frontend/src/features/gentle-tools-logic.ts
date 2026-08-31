export const MAX_GENTLE_PLAN_ITEMS = 3
export const MAX_GENTLE_PLAN_TEXT_LENGTH = 80
export const FOCUS_DURATIONS = [5, 10, 15, 25] as const
export const MIN_FOCUS_DURATION_MINUTES = 1
export const MAX_FOCUS_DURATION_MINUTES = 90

export type FocusDurationMinutes = number
export type CountdownStatus = 'idle' | 'running' | 'paused' | 'completed'

export type GentlePlanItem = {
  id: string
  text: string
  completed: boolean
}

export type FocusSessionCompletion = {
  id: string
  durationMinutes: FocusDurationMinutes
  completedAt: string
}

export function isFocusDurationMinutes(value: unknown): value is FocusDurationMinutes {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_FOCUS_DURATION_MINUTES
    && value <= MAX_FOCUS_DURATION_MINUTES
}

export function isPresetFocusDuration(value: number) {
  return FOCUS_DURATIONS.some((minutes) => minutes === value)
}

export type EnvironmentSceneId = 'start' | 'low-energy' | 'busy' | 'wind-down'
export type SensorySceneId = 'visual' | 'sound' | 'information' | 'body'

export type ToolScene<TId extends string> = {
  id: TId
  label: string
  hint: string
  suggestions: readonly string[]
}

export type SceneApplication<TId extends string> = {
  id: string
  sceneId: TId
  suggestion: string
  appliedAt: string
}

export type MicroMovement = {
  id: string
  name: string
  durationSeconds: 60 | 120 | 180
  summary: string
  steps: readonly string[]
  safetyNote: string
}

export type MicroMovementCompletion = {
  id: string
  movementId: string
  movementName: string
  durationSeconds: number
  completedAt: string
}

export const ENVIRONMENT_SCENES: readonly ToolScene<EnvironmentSceneId>[] = [
  {
    id: 'start',
    label: '准备开始',
    hint: '给任务留一个清楚入口',
    suggestions: [
      '只留下这一步需要的页面和物品。',
      '把手机放到一臂之外，暂时关闭非必要提醒。',
      '先放好水，再写下本轮唯一的目标。',
    ],
  },
  {
    id: 'low-energy',
    label: '能量较低',
    hint: '降低身体和环境的额外负担',
    suggestions: [
      '把常用物品移到伸手可及的位置。',
      '如果方便，选择有靠背的座位，让双脚有支撑。',
      '只打开一盏舒服的灯，屏幕亮度调到不费力。',
    ],
  },
  {
    id: 'busy',
    label: '环境很忙',
    hint: '给注意力圈出一小块空间',
    suggestions: [
      '面向相对简洁的墙面或桌面，减少视线里的动态。',
      '使用一个稳定的背景声，不需要完全安静。',
      '在手边放一张纸，把突然想到的事先记下，不立即处理。',
    ],
  },
  {
    id: 'wind-down',
    label: '准备收尾',
    hint: '让环境提醒自己可以慢下来',
    suggestions: [
      '保存当前进度，留下下次开始的一句提示。',
      '收起一样工作物品，把它当作今天的结束信号。',
      '逐步降低屏幕和室内亮度，不必一次全部关掉。',
    ],
  },
]

export const SENSORY_SCENES: readonly ToolScene<SensorySceneId>[] = [
  {
    id: 'visual',
    label: '视觉太满',
    hint: '页面、灯光或周围东西太多',
    suggestions: [
      '暂时隐藏不用的窗口，屏幕上只留一个任务。',
      '将视线移向稍远、轮廓简单的物体几秒。',
      '如果舒服，降低屏幕亮度或切换到柔和的配色。',
    ],
  },
  {
    id: 'sound',
    label: '声音太多',
    hint: '对话、提示音或突发声让人分心',
    suggestions: [
      '先静音一个不紧急的提醒来源。',
      '如果使用耳机，保持舒适音量，并留意周围安全信号。',
      '找一个相对稳定的声音作为注意锚点。',
    ],
  },
  {
    id: 'information',
    label: '信息太多',
    hint: '消息、待办和想法同时涌进来',
    suggestions: [
      '把新想法记进“稍后”清单，现在不做决定。',
      '用一句话写下：“接下来我只做……”。',
      '设置一个短暂的无通知时段，结束后再统一查看。',
    ],
  },
  {
    id: 'body',
    label: '身体感觉很强',
    hint: '衣物、姿势或温度让注意力难以移开',
    suggestions: [
      '先松开一个带来束缚感的非必要物品。',
      '调整坐姿或温度，以舒服、稳定为准，不追求标准姿势。',
      '选一个中性触感作为锚点，比如双脚接触地面的感觉。',
    ],
  },
]

export const MICRO_MOVEMENTS: readonly MicroMovement[] = [
  {
    id: 'shoulder-release',
    name: '坐姿肩膀放松',
    durationSeconds: 60,
    summary: '让肩膀做小幅度、缓慢的活动。',
    steps: ['双脚稳稳放好，手臂自然下垂。', '肩膀轻轻向上，再向后、向下画小圈。', '保持自然呼吸，中途可以随时停下。'],
    safetyNote: '只做舒服幅度，若出现疼痛、头晕或不适请停止。',
  },
  {
    id: 'hands-reset',
    name: '手指与手腕缓冲',
    durationSeconds: 120,
    summary: '适合长时间打字或握持手机后。',
    steps: ['放下手里的物品，让手掌松开。', '缓慢张开手指，再轻轻收回，不用力握拳。', '小幅度转动手腕，两侧都以舒服为准。'],
    safetyNote: '避免快速、用力或拉到疼痛；有不适就恢复静止。',
  },
  {
    id: 'ankle-pumps',
    name: '坐姿脚踝微动',
    durationSeconds: 120,
    summary: '不需要站起来，让久坐后的双脚轻轻活动。',
    steps: ['坐稳并保持身体有支撑。', '一只脚的脚跟着地，缓慢抬起和放下脚尖。', '换另一侧，或两侧交替，速度以轻松为准。'],
    safetyNote: '保持坐稳；如脚踝或腿部有疼痛、麻木或不适请停止。',
  },
  {
    id: 'gentle-walk',
    name: '三分钟轻松走动',
    durationSeconds: 180,
    summary: '在安全、平整的小范围里换个视角。',
    steps: ['先确认周围通道平整、没有障碍物。', '以平常舒服的步幅慢慢走，不追求速度。', '留意呼吸和脚下，需要时扶稳定物或直接停下。'],
    safetyNote: '仅在站立和行走对你安全时进行；头晕、乏力或不稳时请选坐姿动作。',
  },
]

export function normalizeGentlePlan(items: readonly GentlePlanItem[]): GentlePlanItem[] {
  const seen = new Set<string>()
  const normalized: GentlePlanItem[] = []
  for (const item of items) {
    if (!item.id.trim() || !item.text.trim() || seen.has(item.id)) continue
    seen.add(item.id)
    normalized.push({
      id: item.id,
      text: item.text.trim().slice(0, MAX_GENTLE_PLAN_TEXT_LENGTH),
      completed: Boolean(item.completed),
    })
    if (normalized.length >= MAX_GENTLE_PLAN_ITEMS) break
  }
  return normalized
}

export function addGentlePlanItem(
  items: readonly GentlePlanItem[],
  text: string,
  id: string,
): GentlePlanItem[] {
  const current = normalizeGentlePlan(items)
  const normalizedText = text.trim().slice(0, MAX_GENTLE_PLAN_TEXT_LENGTH)
  if (!normalizedText || current.length >= MAX_GENTLE_PLAN_ITEMS) return current
  return [...current, { id, text: normalizedText, completed: false }]
}

export function toggleGentlePlanItem(items: readonly GentlePlanItem[], id: string): GentlePlanItem[] {
  return normalizeGentlePlan(items).map((item) => (
    item.id === id ? { ...item, completed: !item.completed } : item
  ))
}

export function removeGentlePlanItem(items: readonly GentlePlanItem[], id: string): GentlePlanItem[] {
  return normalizeGentlePlan(items).filter((item) => item.id !== id)
}

export function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function getEnvironmentScene(sceneId: EnvironmentSceneId) {
  return ENVIRONMENT_SCENES.find((scene) => scene.id === sceneId) ?? ENVIRONMENT_SCENES[0]
}

export function getSensoryScene(sceneId: SensorySceneId) {
  return SENSORY_SCENES.find((scene) => scene.id === sceneId) ?? SENSORY_SCENES[0]
}

export function getMicroMovement(movementId: string) {
  return MICRO_MOVEMENTS.find((movement) => movement.id === movementId) ?? MICRO_MOVEMENTS[0]
}

export function createToolId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
