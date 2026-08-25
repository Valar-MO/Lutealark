import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rewriteSameOriginForApiProxy } from './vite-proxy-origin.js'

const API_TARGET = 'http://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, browserRequest) => {
            rewriteSameOriginForApiProxy(proxyRequest, browserRequest, API_TARGET)
          })
        },
      },
    },
  },
})
