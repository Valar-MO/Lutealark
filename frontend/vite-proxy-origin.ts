import type { ClientRequest, IncomingMessage } from 'node:http'

export function proxiedSameOrigin(
  origin: string | undefined,
  host: string | undefined,
  targetOrigin: string,
): string | undefined {
  if (!origin || !host) return undefined

  try {
    const parsedOrigin = new URL(origin)
    const hostname = parsedOrigin.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    if (!isLoopback || parsedOrigin.protocol !== 'http:' || parsedOrigin.host !== host) return undefined
  } catch {
    return undefined
  }

  return targetOrigin
}

export function rewriteSameOriginForApiProxy(
  proxyRequest: ClientRequest,
  browserRequest: IncomingMessage,
  targetOrigin: string,
): void {
  const origin = Array.isArray(browserRequest.headers.origin)
    ? browserRequest.headers.origin[0]
    : browserRequest.headers.origin
  const rewrittenOrigin = proxiedSameOrigin(origin, browserRequest.headers.host, targetOrigin)
  if (rewrittenOrigin) proxyRequest.setHeader('Origin', rewrittenOrigin)
}
