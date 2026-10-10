import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  // Agent worktrees live under .claude/worktrees/; don't let them trigger
  // reloads. Matched relative to this project so a server started inside a
  // worktree still watches its own files.
  server: { watch: { ignored: [`${import.meta.dirname}/.claude/**`] } },
});
