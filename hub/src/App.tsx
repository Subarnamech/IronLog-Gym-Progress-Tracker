import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightIcon, DownloadIcon, MoonIcon, SearchIcon, SunIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'

type Tool = {
  slug: string
  name: string
  description?: string
  category?: string
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<unknown>
}

declare global {
  interface Window {
    OMNIPORTA_TOOLS?: Tool[]
  }
}

const TOOLS: Tool[] = window.OMNIPORTA_TOOLS ?? []

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('omniporta-theme', next ? 'dark' : 'light')
    } catch {
      // private mode: the choice just doesn't persist
    }
    setDark(next)
  }
  return { dark, toggle }
}

// Install OmniPorta (the hub app). Never offered when already running as an installed app.
function useInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    function onInstalled() {
      setPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice.catch(() => {})
    setPrompt(null)
  }

  return { canPrompt: !installed && prompt !== null, needsIOSSteps: !installed && isIOS, install }
}

function PortalMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M81.95 38.37 A34 34 0 1 1 61.63 18.05" strokeWidth="9" />
      <circle cx="50" cy="50" r="21" strokeWidth="6" opacity=".6" />
      <circle cx="50" cy="50" r="8" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ToolRow({ tool }: { tool: Tool }) {
  // Relative links, so the hub works at a domain root or under a sub-path like /repo/
  const base = encodeURIComponent(tool.slug) + '/'
  return (
    <li>
      <a
        href={base}
        className="group flex items-center gap-4 rounded-xl px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
      >
        <img
          src={base + 'icons/icon-192.png'}
          alt=""
          width={44}
          height={44}
          loading="lazy"
          className="size-11 shrink-0 rounded-lg border"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{tool.name}</span>
            {tool.category && <Badge variant="secondary">{tool.category}</Badge>}
          </div>
          {tool.description && (
            <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{tool.description}</p>
          )}
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </a>
    </li>
  )
}

export default function App() {
  const { dark, toggle } = useTheme()
  const { canPrompt, needsIOSSteps, install } = useInstall()
  const [query, setQuery] = useState('')
  const [iosOpen, setIosOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const term = query.trim().toLowerCase()
  const results = useMemo(
    () =>
      TOOLS.filter(
        (t) => !term || `${t.name} ${t.description ?? ''} ${t.category ?? ''}`.toLowerCase().includes(term),
      ),
    [term],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? ''
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between gap-3">
        <a href="./" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="OmniPorta home">
          <span className="grid size-7 place-items-center rounded-md bg-neutral-950 text-neutral-50 ring-1 ring-foreground/10">
            <PortalMark className="size-5" />
          </span>
          OmniPorta
        </a>
        <div className="flex items-center gap-1">
          {(canPrompt || needsIOSSteps) && (
            <Button variant="outline" onClick={() => (canPrompt ? install() : setIosOpen(true))}>
              <DownloadIcon data-icon="inline-start" />
              Install
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>
      </header>

      <main className="flex-1 pt-8 pb-16 sm:pt-12">
        <div className="flex items-baseline justify-between gap-4 px-3 sm:px-4">
          <h1 className="text-2xl font-semibold tracking-tight">Tools</h1>
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {term ? `${results.length} of ${TOOLS.length}` : TOOLS.length}
          </p>
        </div>

        <div className="relative mt-4 px-3 sm:px-4">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground sm:left-6.5" />
          <label htmlFor="q" className="sr-only">
            Search tools
          </label>
          <Input
            ref={searchRef}
            id="q"
            type="search"
            placeholder="Search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            className="h-9 pr-9 pl-8.5"
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 sm:right-6">/</Kbd>
        </div>

        {results.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-0.5" aria-label="Tools">
            {results.map((t) => (
              <ToolRow key={t.slug} tool={t} />
            ))}
          </ul>
        ) : (
          <Empty className="mt-3">
            <EmptyHeader>
              <EmptyTitle>{term ? `Nothing matches “${query.trim()}”` : 'No tools yet'}</EmptyTitle>
              <EmptyDescription>
                {term ? 'Try a different name or category.' : 'Tools show up here as they are added.'}
              </EmptyDescription>
            </EmptyHeader>
            {term && (
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  Clear search
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
      </main>

      <footer className="border-t px-3 py-5 text-sm text-pretty text-muted-foreground sm:px-4">
        Install from this page to get every tool in one app. To install a single tool on its own, open it first and
        install from there.
      </footer>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Install OmniPorta</DialogTitle>
            <DialogDescription>Safari installs apps from its share menu.</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Tap the <b className="font-medium">Share</b> button.
            </li>
            <li>
              Choose <b className="font-medium">Add to Home Screen</b>.
            </li>
            <li>
              Tap <b className="font-medium">Add</b>.
            </li>
          </ol>
          <DialogFooter>
            <DialogClose render={<Button />}>Got it</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
