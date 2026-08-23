import type { KnowledgeSource } from '../store/app-store'
import type { MemoryCandidate } from '@lutealark/contracts'

const SENSITIVE_MEMORY_PATTERN = /(自杀|轻生|自残|伤害自己|不想活|焦虑|难过|低落|崩溃|烦躁|压力|紧张|害怕|委屈|心慌|想哭|疲惫|睡不好|失眠|情绪|月经|经期|周期|黄体|卵泡|排卵|怀孕|疾病|诊断|症状|疼痛|用药|药物|病史)/
const PRIVATE_AGENT_METADATA_KEYS = new Set([
  'memorycandidatestatus',
  'memorycontext',
  'memoryitems',
  'usagepolicy',
  'memoryusagepolicy',
  'savedmemorycontext',
  'savedmemoryusagepolicy',
  'longtermmemorycontext',
])
const RAG_INTENTS = new Set([
  'task_difficulty',
  'cycle_question',
  'emotion_support',
])

export type ParsedChatMetadata = {
  intent?: string
  action?: string
  mode?: 'online' | 'offline'
  ragUsed?: boolean
  sources: KnowledgeSource[]
  memoryCandidate?: MemoryCandidate
  memoryCandidateStatus?: 'saved' | 'dismissed'
}

export function parseChatMetadata(metadata: Record<string, unknown>): ParsedChatMetadata {
  return parseChatMetadataValue(metadata, true)
}

/** Agent transport metadata cannot assert that the user already saved or dismissed a candidate. */
export function parseAgentReplyMetadata(metadata: Record<string, unknown>): ParsedChatMetadata {
  return parseChatMetadataValue(metadata, false)
}

/** Keep a fresh agent response restorable without persisting an untrusted user-decision status. */
export function sanitizeAgentReplyMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized = Object.fromEntries(Object.entries(metadata).filter(([key]) => (
    !PRIVATE_AGENT_METADATA_KEYS.has(normalizeMetadataKey(key))
  )))
  const intent = stringValue(metadata.intent)
  if (intent === 'safety_crisis' || intent === 'crisis_support') {
    for (const key of Object.keys(sanitized)) {
      const normalizedKey = normalizeMetadataKey(key)
      if (normalizedKey === 'sources' || normalizedKey === 'memorycandidate') delete sanitized[key]
    }
  }
  return sanitized
}

function normalizeMetadataKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseChatMetadataValue(
  metadata: Record<string, unknown>,
  acceptPersistedMemoryStatus: boolean,
): ParsedChatMetadata {
  const intent = stringValue(metadata.intent)
  const crisisIntent = intent === 'safety_crisis' || intent === 'crisis_support'
  const mode = metadata.mode === 'offline' ? 'offline' : metadata.mode === 'online' ? 'online' : undefined
  const parsedSources = crisisIntent ? [] : parseKnowledgeSources(metadata.sources)
  const hasAuthoritativeSource = parsedSources.some((source) => Boolean(source.sourceId))
  const hasVerifiedRag = mode === 'online'
    && RAG_INTENTS.has(intent ?? '')
    && metadata.ragUsed === true
    && hasAuthoritativeSource
  return {
    intent,
    action: stringValue(metadata.action),
    mode,
    ragUsed: crisisIntent || mode === 'offline'
      ? false
      : hasVerifiedRag
        ? true
        : metadata.ragUsed === false
          ? false
          : undefined,
    // Sources without an explicit RAG assertion are not evidence and must not
    // be rendered as though they came from a verified retrieval run.
    sources: hasVerifiedRag ? parsedSources : [],
    memoryCandidate: intent === 'memory_request'
      ? parseMemoryCandidate(metadata.memoryCandidate ?? metadata.memory_candidate)
      : undefined,
    memoryCandidateStatus: acceptPersistedMemoryStatus
      && (metadata.memoryCandidateStatus === 'saved' || metadata.memoryCandidateStatus === 'dismissed')
      ? metadata.memoryCandidateStatus
      : undefined,
  }
}

export function parseMemoryCandidate(value: unknown): MemoryCandidate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const candidateId = stringValue(candidate.candidateId)
  const kind = candidate.kind
  const summary = stringValue(candidate.summary)
  const sourceTurnHash = stringValue(candidate.sourceTurnHash)
  if (!candidateId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) return undefined
  if (kind !== 'preference' && kind !== 'constraint' && kind !== 'long_term_goal') return undefined
  if (!summary || summary.length > 300 || candidate.requiresConsent !== true) return undefined
  if (SENSITIVE_MEMORY_PATTERN.test(summary)) return undefined
  if (!sourceTurnHash || !/^[0-9a-f]{64}$/i.test(sourceTurnHash)) return undefined
  return { candidateId, kind, summary, requiresConsent: true, sourceTurnHash }
}

export function parseKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: KnowledgeSource[] = []
  for (const candidate of value) {
    const source = normalizeSource(candidate)
    if (!source) continue
    const key = `${source.sourceId ?? ''}|${source.title}|${source.url ?? ''}|${source.chunkId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(source)
    if (result.length >= 3) break
  }
  return result
}

function normalizeSource(value: unknown): KnowledgeSource | null {
  if (typeof value === 'string') {
    const title = value.trim().slice(0, 200)
    return title ? { title } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const source = value as Record<string, unknown>
  const sourceId = firstString(source.sourceId, source.id)?.slice(0, 200)
  if (!sourceId) return null
  const title = firstString(source.title, source.name, source.fileName, source.documentName, sourceId)
    ?.slice(0, 200)
  if (!title) return null

  const rawUrl = firstString(source.url, source.href, source.fileUrl)
  const url = rawUrl && isSafeHttpUrl(rawUrl) ? rawUrl : undefined
  const score = typeof source.score === 'number' && Number.isFinite(source.score)
    ? Math.max(0, Math.min(1, source.score))
    : undefined

  return {
    title,
    sourceId,
    chunkId: firstString(source.chunkId)?.slice(0, 200),
    excerpt: firstString(source.excerpt, source.snippet, source.chunkContent)?.slice(0, 500),
    url,
    score,
  }
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (isPrivateHostname(hostname)) return false
    const sensitiveKeys = ['token', 'signature', 'credential', 'app_key', 'appkey', 'expires']
    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.toLowerCase()
      if (sensitiveKeys.some((sensitive) => normalizedKey.includes(sensitive))) return false
    }
    return true
  } catch {
    return false
  }
}

function isPrivateHostname(hostname: string) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true
  if (hostname === '::' || hostname === '::1' || hostname.startsWith('::ffff:') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb') || hostname.startsWith('fec') || hostname.startsWith('fed') || hostname.startsWith('fee') || hostname.startsWith('fef') || hostname.startsWith('fc') || hostname.startsWith('fd')) return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!ipv4) return false
  const octets = ipv4.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return true
  const [first, second] = octets
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}
