import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend unit/hook tests (Testing Suite plan, Phase 1). Kept separate from
// vite.config.ts, which carries Tauri dev-server specifics that tests don't
// want. jsdom supplies DOM APIs (DOMParser for the sanitizer, localStorage for
// the auth-migration tests); all Tauri plugin modules are mocked per test.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Restore real timers/mocks between files so test order can't couple.
    clearMocks: true,
  },
});
