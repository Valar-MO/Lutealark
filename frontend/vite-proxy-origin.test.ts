import { describe, expect, it } from 'vitest'
import { proxiedSameOrigin } from './vite-proxy-origin.js'

const API_TARGET = 'http://127.0.0.1:3000'

describe('Vite API proxy Origin forwarding', () => {
  it.each([
    ['http://127.0.0.1:5173', '127.0.0.1:5173'],
    ['http://127.0.0.1:5175', '127.0.0.1:5175'],
    ['http://localhost:5175', 'localhost:5175'],
  ])('rewrites the exact browser-facing Vite origin', (origin, host) => {
    expect(proxiedSameOrigin(origin, host, API_TARGET)).toBe(API_TARGET)
  })

  it.each([
    ['https://attacker.example', '127.0.0.1:5175'],
    ['http://127.0.0.1:5176', '127.0.0.1:5175'],
    ['https://127.0.0.1:5175', '127.0.0.1:5175'],
    ['http://dev.example:5175', 'dev.example:5175'],
    ['not an origin', '127.0.0.1:5175'],
    [undefined, '127.0.0.1:5175'],
    ['http://127.0.0.1:5175', undefined],
  ])('does not rewrite a request that is not exact same-origin', (origin, host) => {
    expect(proxiedSameOrigin(origin, host, API_TARGET)).toBeUndefined()
  })
})
