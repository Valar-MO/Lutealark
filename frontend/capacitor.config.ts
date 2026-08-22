import type { CapacitorConfig } from '@capacitor/cli'

const configuredServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()
const remoteServerUrl = configuredServerUrl ? validateRemoteServerUrl(configuredServerUrl) : undefined

const config: CapacitorConfig = {
  appId: 'com.lutealark.app',
  appName: 'Lutealark',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
    ...(remoteServerUrl ? { url: remoteServerUrl } : {}),
  },
  android: {
    allowMixedContent: false,
  },
}

export default config

function validateRemoteServerUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('CAPACITOR_SERVER_URL must use HTTPS')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('CAPACITOR_SERVER_URL must not contain credentials, query parameters, or a fragment')
  }
  return url.toString().replace(/\/$/, '')
}
