import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  // Agent worktrees live under .claude/; don't let them trigger reloads.
  server: { watch: { ignored: ['**/.claude/**'] } },
});
