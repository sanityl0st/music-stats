// frontend/src/App.tsx
import { useState, useEffect } from 'react'
import CosmicBackground from './components/canvas/CosmicBackground'
import StatsDashboard from './components/ui/StatsDashboard'
import PS2ShelfView from './components/canvas/PS2ShelfView'
import { useThemeStore } from './store/useThemeStore'
import { BarChart3, Disc, Eye, EyeOff } from 'lucide-react'

export default function App() {
  const [activePage, setActivePage] = useState<'stats' | 'shelf'>('stats')
  const [zenMode, setZenMode] = useState(false)
  const { backgroundMode, customPhotoUrl, primaryColor } = useThemeStore()

  // Allow pressing Escape to exit Zen Screensaver Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zenMode) {
        setZenMode(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [zenMode])

  return (
    <div className="relative min-h-screen text-white">
      {/* Dynamic 3D Space or Photo Background for the Stats Page */}
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

      {/* Top Navigation Bar (Hidden when Zen Screensaver Mode is active) */}
      {!zenMode && (
        <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-black/70 px-6 backdrop-blur-xl transition-opacity duration-500">
          <div className="flex items-center gap-2 font-black tracking-wider text-lg">
            <Disc className="h-6 w-6 animate-spin" style={{ color: primaryColor, animationDuration: '8s' }} />
            <span>ASTRAL // WAX</span>
          </div>

          <div className="flex items-center gap-2.5">
            {activePage === 'stats' && (
              <button
                onClick={() => setZenMode(true)}
                className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/15 transition"
                title="Hide all UI to enjoy the 3D galaxy background"
              >
                <EyeOff className="h-4 w-4 text-purple-400" />
                <span className="hidden sm:inline">Zen Mode (Hide UI)</span>
              </button>
            )}

            <button
              onClick={() => setActivePage('stats')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activePage === 'stats' ? 'bg-white text-black' : 'text-zinc-300 hover:bg-white/10'
              }`}
            >
              <BarChart3 className="h-4 w-4" /> STATS.FM DASHBOARD
            </button>
            <button
              onClick={() => setActivePage('shelf')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold font-mono transition ${
                activePage === 'shelf'
                  ? 'bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                  : 'text-emerald-400 hover:bg-emerald-950/60 border border-emerald-800/60'
              }`}
            >
              <Disc className="h-4 w-4" /> COLLECTION
            </button>
          </div>
        </nav>
      )}

      {/* Floating Restore Button during Zen Screensaver Mode */}
      {zenMode && activePage === 'stats' && (
        <button
          onClick={() => setZenMode(false)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-4 py-2.5 text-xs font-bold text-white/70 opacity-40 hover:opacity-100 hover:bg-black/85 backdrop-blur-md transition-all duration-300 shadow-lg"
        >
          <Eye className="h-4 w-4 text-purple-400" /> Show UI (ESC)
        </button>
      )}

      {/* Active Page Content */}
      {activePage === 'stats' ? !zenMode && <StatsDashboard /> : <PS2ShelfView />}
    </div>
  )
}