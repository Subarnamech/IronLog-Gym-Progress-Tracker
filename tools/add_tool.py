#!/usr/bin/env python3
"""Add a new tool to OmniPorta.

    python3 tools/add_tool.py --slug budget --name "Budget" \
        --description "Track monthly spending." --category Finance --color "#16a34a"

What it does
  1. Creates public/<slug>/ with a starter index.html, manifest.webmanifest and sw.js.
     The manifest has its own id, name, scope (/<slug>/) and icons, so installing the tool
     from inside its page gives an app with only that tool, named after it.
  2. Generates matching icons (a letter on your colour; replace them later with your own artwork).
  3. Adds the tool to public/tools.js so it appears as a card on the hub.
  4. Bumps the hub service worker's cache version so the hub shows the new card straight away.

Then replace public/<slug>/index.html's <main> with your tool and run `firebase deploy --only hosting`.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PUBLIC = os.path.join(ROOT, "public")
sys.path.insert(0, HERE)
from make_icons import monogram_set  # noqa: E402

RESERVED = {"icons", "tools", "assets", "__", "sw", "manifest", "index"}

MANIFEST = """{
  "name": "__NAME__",
  "short_name": "__SHORT__",
  "description": "__DESC__",
  "start_url": "./?source=pwa",
  "scope": "./",
  "display": "standalone",
  "background_color": "__COLOR__",
  "theme_color": "__COLOR__",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
"""

SW = """/* __NAME__ service worker: scope is this tool's folder only (paths are relative to wherever it is hosted).
   Bump CACHE_VERSION every time you change this tool's files so installed copies update. */
const CACHE_VERSION = '__SLUG__-v1';
const BASE = new URL(self.registration.scope).pathname; // e.g. "/__SLUG__/" or "/repo/__SLUG__/"
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('__SLUG__-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(BASE + 'index.html', copy));
          return res;
        })
        .catch(() => caches.match(BASE + 'index.html').then((r) => r || caches.match(BASE)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
"""

INDEX = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__NAME__</title>
<!-- PWA: this tool's own app identity (separate from the OmniPorta hub) -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="__COLOR__">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="__NAME__">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<script>
  // Launched from the installed app (start_url has ?source=pwa): hide the link back to the hub.
  try { if (/[?&]source=pwa\\b/.test(location.search)) sessionStorage.setItem('standalone', '1'); } catch (e) {}
  var standalone = false;
  try { standalone = sessionStorage.getItem('standalone') === '1'; } catch (e) {}
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function (e) { console.warn(e); });
    });
  }
  window.addEventListener('DOMContentLoaded', function () {
    if (standalone) { var b = document.getElementById('back'); if (b) b.hidden = true; }
  });
</script>
<style>
  body{margin:0; font-family:ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height:1.5; color:#09090b; background:#fff;}
  @media (prefers-color-scheme:dark){ body{color:#fafafa; background:#09090b;} }
  main{max-width:40rem; margin:0 auto; padding:2rem 1rem;}
  a{color:inherit;}
</style>
</head>
<body>
<main>
  <a id="back" href="../">Back to OmniPorta</a>
  <h1>__NAME__</h1>
  <p>__DESC__</p>
  <!-- Build your tool here. -->
</main>
</body>
</html>
"""


def fill(template, **kw):
    for k, v in kw.items():
        template = template.replace("__%s__" % k.upper(), v)
    return template


def json_str(s):
    return json.dumps(s, ensure_ascii=False)[1:-1]  # escaped, without the surrounding quotes


def main():
    ap = argparse.ArgumentParser(description="Add a tool to OmniPorta")
    ap.add_argument("--slug", required=True, help="folder / URL name, e.g. budget (lowercase letters, digits, dashes)")
    ap.add_argument("--name", required=True, help="display name, e.g. Budget")
    ap.add_argument("--description", required=True, help="one sentence shown on the card")
    ap.add_argument("--category", default="Tool", help="badge text on the card")
    ap.add_argument("--color", default="#18181b", help="accent colour for the starter icon and theme, e.g. #16a34a")
    ap.add_argument("--letter", help="letter on the icon (default: first letter of the name)")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", a.slug) or a.slug in RESERVED:
        sys.exit("error: --slug must be lowercase letters, digits and dashes (not one of: %s)" % ", ".join(sorted(RESERVED)))
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", a.color):
        sys.exit("error: --color must look like #16a34a")
    folder = os.path.join(PUBLIC, a.slug)
    if os.path.exists(folder):
        sys.exit("error: public/%s already exists" % a.slug)

    tools_js = os.path.join(PUBLIC, "tools.js")
    src = open(tools_js, encoding="utf-8").read()
    m = re.search(r"/\* TOOLS:START \*/(.*?)/\* TOOLS:END \*/", src, re.S)
    if not m:
        sys.exit("error: could not find the TOOLS:START / TOOLS:END markers in public/tools.js")
    tools = json.loads(m.group(1))
    if any(t.get("slug") == a.slug for t in tools):
        sys.exit("error: %s is already listed in tools.js" % a.slug)

    os.makedirs(os.path.join(folder, "icons"))
    vals = dict(name=json_str(a.name), short=json_str(a.name[:12]), desc=json_str(a.description), slug=a.slug, color=a.color)
    html_vals = dict(vals, name=a.name.replace("&", "&amp;").replace("<", "&lt;"), desc=a.description.replace("&", "&amp;").replace("<", "&lt;"))
    open(os.path.join(folder, "manifest.webmanifest"), "w", encoding="utf-8").write(fill(MANIFEST, **vals))
    open(os.path.join(folder, "sw.js"), "w", encoding="utf-8").write(fill(SW, **dict(vals, name=a.name.replace("*/", ""))))
    open(os.path.join(folder, "index.html"), "w", encoding="utf-8").write(fill(INDEX, **html_vals))
    monogram_set(os.path.join(folder, "icons"), a.letter or a.name[0], a.color)

    tools.append({"slug": a.slug, "name": a.name, "description": a.description, "category": a.category})
    new_block = "[\n" + ",\n".join("  " + json.dumps(t, indent=2, ensure_ascii=False).replace("\n", "\n  ") for t in tools) + "\n] "
    src = src[:m.start(1)] + " " + new_block + src[m.end(1):]
    open(tools_js, "w", encoding="utf-8").write(src)

    sw_path = os.path.join(PUBLIC, "sw.js")
    sw = open(sw_path, encoding="utf-8").read()
    sw = re.sub(r"omniporta-v(\d+)", lambda mm: "omniporta-v%d" % (int(mm.group(1)) + 1), sw, count=1)
    open(sw_path, "w", encoding="utf-8").write(sw)

    print("Added %s -> /%s/" % (a.name, a.slug))
    print("  edit  public/%s/index.html   (build the tool)" % a.slug)
    print("  swap  public/%s/icons/*.png  (optional: your own artwork, same file names and sizes)" % a.slug)
    print("  then  firebase deploy --only hosting")


if __name__ == "__main__":
    main()
