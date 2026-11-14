import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { artCriticPlugin } from './server/artCriticPlugin.ts'

export default defineConfig({
  plugins: [react(), artCriticPlugin(import.meta.dirname)],
  server: {
    port: 5317,
    // Exports and saved state change on disk; they're fetched via the API, not hot-reloaded.
    watch: { ignored: ['**/state/**'] },
  },
})
