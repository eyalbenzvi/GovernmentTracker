import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages base path resolution.
 *
 * - `<user>.github.io` repositories are served from the domain root -> base '/'.
 * - Any other repository is served from '/<repo>/'.
 * - Local dev / preview falls back to '/' unless VITE_BASE is provided.
 *
 * GITHUB_REPOSITORY is injected automatically by GitHub Actions as "owner/repo".
 */
function resolveBase(): string {
  if (process.env.VITE_BASE) return process.env.VITE_BASE;
  const slug = process.env.GITHUB_REPOSITORY;
  if (!slug) return '/';
  const repo = slug.split('/')[1];
  if (!repo) return '/';
  if (repo.toLowerCase().endsWith('.github.io')) return '/';
  return `/${repo}/`;
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  // The diary shards are large (the biggest section runs to tens of thousands of
  // rows). Emitting them as JSON.parse of a string literal, rather than as a
  // JavaScript object literal, keeps both the build and the browser's parse fast
  // at that size. Only default imports are used, which is what this mode allows.
  json: {
    stringify: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
