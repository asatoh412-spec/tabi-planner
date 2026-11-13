import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'

// 版の識別子（組み立てた日時）。アプリはこれと公開中の version.json を比べて、新しい版があれば知らせる
const BUILD = new Date().toISOString()

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    { name: 'version-json', writeBundle(opts) { writeFileSync(`${opts.dir}/version.json`, JSON.stringify({ build: BUILD })) } },
  ],
})
