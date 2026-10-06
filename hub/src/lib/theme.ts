import { useState } from 'react'

// Shared by the hub and every tool built here, so one theme choice applies everywhere.
export function useTheme() {
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
