import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '..')

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.html': 'text/html',
  '.json': 'application/json',
}

// The hub is built into the repo root, next to files it doesn't own: tools.js, the hub
// manifest and icons, and each tool's folder. In dev, serve those straight from the root
// so the page behaves the same as the deployed site.
function serveRepoRoot(): Plugin {
  return {
    name: 'omniporta-serve-repo-root',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!/^\/(tools\.js|manifest\.webmanifest|icons\/|[^/]+\/(icons\/|index\.html$|$))/.test(pathname)) {
          return next()
        }
        let file = path.join(repoRoot, pathname)
        if (!file.startsWith(repoRoot)) return next()
        if (pathname.endsWith('/')) file = path.join(file, 'index.html')
        fs.readFile(file, (err, data) => {
          if (err) return next()
          res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
          res.end(data)
        })
      })
    },
  }
}

// emptyOutDir is off (see below), so clear the previous build's hashed files by hand.
function cleanAssets(): Plugin {
  return {
    name: 'omniporta-clean-assets',
    apply: 'build',
    buildStart() {
      fs.rmSync(path.join(repoRoot, 'assets'), { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs, so the hub works at a domain root or under a sub-path like /repo/
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss(), serveRepoRoot(), cleanAssets()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    // index.html and assets/ land in the repo root, which is what the site is served from.
    // emptyOutDir must stay off: the root also holds the tools and this source folder.
    outDir: repoRoot,
    emptyOutDir: false,
  },
})
