import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo-name>/.
  base: process.env.GITHUB_PAGES ? '/tesla-lightshow-studio/' : '/',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
