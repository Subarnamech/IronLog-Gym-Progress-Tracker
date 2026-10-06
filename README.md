# OmniPorta

One hub site/app that opens all your tools. Iron Log is the first tool.

```
omniporta/
  firebase.json            Firebase Hosting config (serves ./public)
  public/
    index.html             the OmniPorta hub
    tools.js               the list of tools (one card per entry)
    manifest.webmanifest   OmniPorta app: name "OmniPorta", scope /
    sw.js                  hub service worker (scope /)
    icons/                 OmniPorta icons
    ironlog/
      index.html           Iron Log (your app, with the Transformation Log lock)
      manifest.webmanifest Iron Log app: name "Iron Log", scope /ironlog/
      sw.js                Iron Log service worker (scope /ironlog/)
      icons/               Iron Log icons
  tools/
    add_tool.py            adds a new tool (folder, manifest, worker, icons, hub card)
    make_icons.py          regenerates the OmniPorta and Iron Log icons
```

## Deploy

1. Install the Firebase CLI once: `npm install -g firebase-tools`, then `firebase login`.
2. In this folder run `firebase use <your-project-id>` (the same project Iron Log already uses).
3. Run `firebase deploy --only hosting`.
4. Firebase Console > Authentication > Settings > Authorized domains: make sure your `.web.app` and
   `.firebaseapp.com` domains are listed (same as before, nothing new to add).
5. Open `https://<your-project>.web.app/` for the hub. Iron Log is at `/ironlog/`.

Iron Log used to live at the site root. After this deploy the root is the hub, so update any bookmark
or home-screen shortcut for Iron Log to `/ironlog/`. Your data is untouched (same Firebase project,
same sign-in, same origin).

## How installing works

| You install from | App name | Icon | What it shows |
| --- | --- | --- | --- |
| The hub page (`/`) | OmniPorta | portal | the hub with every tool |
| The Iron Log page (`/ironlog/`) | Iron Log | barbell | only Iron Log |

Each is a separate app (different manifest `id`, `scope` and icons), so you can install one, the other, or both.
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
replace the icons in `public/budget/icons/` (same file names and sizes), then deploy.

## Updating later

- Changed Iron Log? Bump `CACHE_VERSION` in `public/ironlog/sw.js` (`ironlog-v3` to `ironlog-v4`).
- Changed the hub? Bump `CACHE_VERSION` in `public/sw.js` (`omniporta-v1` to `omniporta-v2`).
- Then `firebase deploy --only hosting`.

## Test locally

`python3 -m http.server 8000 --directory public` and open http://localhost:8000/ (service workers work on localhost).
