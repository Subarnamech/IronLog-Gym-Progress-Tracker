# OmniPorta

One hub site/app that opens all your tools. Iron Log is the first tool.

```
omniporta/                 the site is served from this folder (the repo root)
  index.html, assets/      the OmniPorta hub, BUILT from hub/ (don't edit by hand)
  tools.js                 the list of tools (one row per entry)
  manifest.webmanifest     OmniPorta app: name "OmniPorta", scope /
  sw.js                    hub service worker (scope /)
  icons/                   OmniPorta icons
  ironlog/
    index.html             Iron Log (single static file, with the Transformation Log lock)
    manifest.webmanifest   Iron Log app: name "Iron Log", scope /ironlog/
    sw.js                  Iron Log service worker (scope /ironlog/)
    icons/                 Iron Log icons
  busbar/
    index.html             Busbar Sizing, BUILT from hub/ (don't edit by hand)
    manifest.webmanifest, sw.js, icons/   written by hand, like any other tool
  hub/                     hub source: Vite + React + Tailwind + shadcn/ui
    src/App.tsx            the hub page
    busbar/index.html, src/busbar/   the Busbar Sizing tool (calc.ts holds the maths)
    src/components/ui/     shadcn/ui components (add more with `npx shadcn@latest add <name>`)
  tools/
    add_tool.py            adds a new tool (folder, manifest, worker, icons, hub entry)
    make_icons.py          regenerates the OmniPorta and Iron Log icons
```

## Changing the hub

The hub is a React app using [shadcn/ui](https://ui.shadcn.com/). You need Node.js 20 or newer.

```
cd hub
npm install      # first time only
npm run dev      # live preview at http://localhost:5173/
npm run build    # writes ../index.html and ../assets/
```

`npm run build` replaces `index.html` and `assets/` in the repo root. Commit those along with your
source changes, and bump `CACHE_VERSION` in `sw.js`. Adding a tool only touches `tools.js`, so it
needs no rebuild.

Busbar Sizing is built alongside the hub: the same `npm run build` writes `busbar/index.html`.
After changing it, bump `CACHE_VERSION` in `busbar/sw.js` as well.

Iron Log is not part of the build. It is one static file styled with the same shadcn/ui theme
tokens in plain CSS; edit `ironlog/index.html` directly.

## Deploy

Everything uses relative paths, so the same files work anywhere: a GitHub Pages project site
(`username.github.io/repo/`), a user site or custom domain (root), or Firebase Hosting.

### Option A: GitHub Pages (copy and push)

1. Open your local copy of the GitHub Pages repo (the folder you push from).
2. Copy everything **inside** `public/` into it, into the same place your old `index.html` lived
   (the repo root, or `docs/` if Pages serves from there). Include the hidden `.nojekyll` file.
   Say yes when asked to replace the old `index.html`.
3. Commit and push:
   ```
   git add -A
   git commit -m "Add OmniPorta hub with Iron Log"
   git push
   ```
4. Wait a minute, then open your site. The hub is at the site address and Iron Log is at `ironlog/` under it.
5. Firebase Console > Authentication > Settings > Authorized domains: `<username>.github.io` must be
   listed (it should be already, if Iron Log signed in from GitHub before).

GitHub Pages can serve files from cache for up to about 10 minutes, so after a push a refresh or two
may be needed before you see the change.

### Option B: Firebase Hosting

1. Install the Firebase CLI once: `npm install -g firebase-tools`, then `firebase login`.
2. In this folder run `firebase use <your-project-id>` (the same project Iron Log already uses).
3. Run `firebase deploy --only hosting`.
4. Make sure your `.web.app` and `.firebaseapp.com` domains are in Authentication > Authorized domains.

### After either option

Iron Log used to be the root page. The root is now the hub, so update any bookmark or home-screen
shortcut for Iron Log to `ironlog/`. Your data is untouched (same Firebase project, same sign-in).

## How installing works

| You install from | App name | Icon | What it shows |
| --- | --- | --- | --- |
| The hub page (`/`) | OmniPorta | portal | the hub with every tool |
| The Iron Log page (`/ironlog/`) | Iron Log | barbell | only Iron Log |

Each is a separate app (different manifest, `scope`, start URL and icons), so you can install one, the other, or both.
Install from a normal browser tab:

- Android/desktop Chrome or Edge: the install button in the address bar or menu. Iron Log also has
  Settings > Install Iron Log, and the hub has an Install app button.
- iPhone/iPad: Safari > Share > Add to Home Screen, once on the hub page and/or once on the Iron Log page.

## Add a tool

```
python3 tools/add_tool.py --slug budget --name "Budget" \
    --description "Track monthly spending." --category Finance --color "#16a34a"
```

This creates `public/budget/` (own manifest, service worker and starter icons), adds the card to
`public/tools.js`, and bumps the hub cache. Build the tool in `public/budget/index.html`, optionally
replace the icons in `public/budget/icons/` (same file names and sizes), then push or deploy.

## Updating later

- Changed Iron Log? Bump `CACHE_VERSION` in `ironlog/sw.js` (`ironlog-v5` to `ironlog-v6`).
- Changed the hub? Rebuild it (see above) and bump `CACHE_VERSION` in `sw.js` (`omniporta-v5` to `omniporta-v6`).
- Then push to GitHub (or `firebase deploy --only hosting`).

## Test locally

`python3 -m http.server 8000 --directory public` and open http://localhost:8000/ (service workers work on localhost).
Opening the files straight from disk (`file://`) shows the pages but not the install/offline features.
