import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo-name>/.
  base: process.env.GITHUB_PAGES ? '/tesla-lightshow-studio/' : '/',
  // Agent worktrees live under .claude/; don't reload the dev server when they change.
  server: { watch: { ignored: ['**/.claude/**'] } },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
