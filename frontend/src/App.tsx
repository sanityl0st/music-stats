import { useState, useEffect } from 'react'
import CosmicBackground from './components/canvas/CosmicBackground'
import StatsDashboard from './components/ui/StatsDashboard'
import PS2ShelfView from './components/canvas/PS2ShelfView'
import { useThemeStore } from './store/useThemeStore'
import { BarChart3, Disc, Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import { apiUrl } from './utils/api'

export default function App() {
  const [activePage, setActivePage] = useState<'stats' | 'shelf'>('stats')
  const [zenMode, setZenMode] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [passphraseInput, setPassphraseInput] = useState('')
  const [authError, setAuthError] = useState('')

  const { backgroundMode, customPhotoUrl, primaryColor } = useThemeStore()

  // Check if we already have a valid admin_key saved in this browser
  const verifyStoredKey = async (keyToTest: string) => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 second timeout

      const res = await fetch(apiUrl('/api/auth/verify'), {
        headers: { 'X-Admin-Key': keyToTest },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        setIsAdmin(false)
        return false
      }

      const contentType = res.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        await res.json()
        setIsAdmin(true)
        localStorage.setItem('admin_key', keyToTest)
        return true
      }
      setIsAdmin(false)
      return false
    } catch {
      setIsAdmin(false)
      return false
    }
  }

  useEffect(() => {
    const savedKey = localStorage.getItem('admin_key') || ''
    verifyStoredKey(savedKey)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zenMode) setZenMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [zenMode])

  const handleAdminUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    const ok = await verifyStoredKey(passphraseInput.trim())
    if (ok) {
      setShowLoginPrompt(false)
      setPassphraseInput('')
    } else {
      setAuthError('Invalid Admin Secret.')
    }
  }

  const handleAdminLock = () => {
    localStorage.removeItem('admin_key')
    setIsAdmin(false)
  }

  return (
    <div className="relative min-h-screen text-white">
      {activePage === 'stats' && (
        <>
          {backgroundMode === 'space3d' || !customPhotoUrl ? (
            <CosmicBackground />
          ) : (
            <div
              className="fixed inset-0 -z-10 bg-cover bg-center"
              style={{ backgroundImage: `url(${customPhotoUrl})` }}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
            </div>
          )}
        </>
      )}

      {!zenMode && (
        <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-black/70 px-4 sm:px-6 backdrop-blur-xl">
          <div className="flex items-center gap-2 font-black tracking-wider text-base sm:text-lg">
            <Disc className="h-6 w-6 animate-spin" style={{ color: primaryColor, animationDuration: '8s' }} />
            <span>ASTRAL // WAX</span>
          </div>

          <div className="flex items-center gap-2">
            {activePage === 'stats' && (
              <button
                onClick={() => setZenMode(true)}
                className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/15 transition"
                title="Hide UI to enjoy the 3D galaxy background"
              >
                <EyeOff className="h-4 w-4 text-purple-400" />
                <span className="hidden md:inline">Zen Mode</span>
              </button>
            )}

            <button
              onClick={() => setActivePage('stats')}
              className={`flex items-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold transition ${
                activePage === 'stats' ? 'bg-white text-black' : 'text-zinc-300 hover:bg-white/10'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">DASHBOARD</span>
            </button>

            <button
              onClick={() => setActivePage('shelf')}
              className={`flex items-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold font-mono transition ${
                activePage === 'shelf'
                  ? 'bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                  : 'text-emerald-400 hover:bg-emerald-950/60 border border-emerald-800/60'
              }`}
            >
              <Disc className="h-4 w-4" /> COLLECTION
            </button>

            {/* Owner Lock / Unlock Button */}
            {isAdmin ? (
              <button
                onClick={handleAdminLock}
                className="flex items-center gap-1 rounded-xl border border-emerald-500/50 bg-emerald-950/50 px-2.5 py-2 text-xs text-emerald-300 hover:bg-emerald-900/60"
                title="Owner Mode Unlocked (Click to lock)"
              >
                <Unlock className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => setShowLoginPrompt(true)}
                className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-400 hover:text-white"
                title="Owner Login (Unlock Sync & Edit)"
              >
                <Lock className="h-4 w-4" />
              </button>
            )}
          </div>
        </nav>
      )}

      {zenMode && activePage === 'stats' && (
        <button
          onClick={() => setZenMode(false)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-4 py-2.5 text-xs font-bold text-white/70 opacity-40 hover:opacity-100 hover:bg-black/85 backdrop-blur-md transition-all duration-300 shadow-lg"
        >
          <Eye className="h-4 w-4 text-purple-400" /> Show UI (ESC)
        </button>
      )}

      {/* Pass isAdmin to both pages so Sync/Add/Delete buttons only show when unlocked */}
      {activePage === 'stats' ? !zenMode && <StatsDashboard isAdmin={isAdmin} /> : <PS2ShelfView isAdmin={isAdmin} />}

      {/* Owner Passphrase Modal */}
      {showLoginPrompt && (
        <div
          onClick={() => setShowLoginPrompt(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAdminUnlock}
            className="w-full max-w-sm rounded-2xl border border-white/20 bg-zinc-950 p-6 shadow-2xl"
          >
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="h-4 w-4 text-purple-400" /> Owner Admin Unlock
            </h3>
            <p className="mt-1 text-xs text-zinc-400">
              Enter your ADMIN_SECRET passphrase to unlock Sync Data and Collection editing.
            </p>
            <input
              type="password"
              required
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder="Enter ADMIN_SECRET..."
              className="mt-4 w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-xs text-white focus:border-purple-400 focus:outline-none"
            />
            {authError && <p className="mt-2 text-xs text-red-400">{authError}</p>}
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowLoginPrompt(false)}
                className="rounded-lg px-3 py-1.5 text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-purple-500 px-4 py-1.5 font-bold text-black hover:bg-purple-400"
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}