import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  base: '/console/',
  plugins: [vue({ template: { transformAssetUrls: { includeAbsolute: false } } })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1300 },
  server: {
    proxy: {
      '/admin': 'http://127.0.0.1:3100',
      '/auth': 'http://127.0.0.1:3100',
      '/downloads': 'http://127.0.0.1:3100',
      '/branding': 'http://127.0.0.1:3100',
    },
  },
})
