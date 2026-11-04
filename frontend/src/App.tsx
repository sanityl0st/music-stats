// frontend/src/App.tsx
import { useState } from 'react'
import CosmicBackground from './components/canvas/CosmicBackground'
import StatsDashboard from './components/ui/StatsDashboard'
import PS2ShelfView from './components/canvas/PS2ShelfView'
import { useThemeStore } from './store/useThemeStore'
import { BarChart3, Disc } from 'lucide-react'

export default function App() {
  const [activePage, setActivePage] = useState<'stats' | 'shelf'>('stats')
  const { backgroundMode, customPhotoUrl, primaryColor } = useThemeStore()

  return (
    <div className="relative min-h-screen text-white">
      {/* Dynamic Background for the Stats Page */}
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

      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-black/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-2 font-black tracking-wider text-lg">
          <Disc className="h-6 w-6 animate-spin" style={{ color: primaryColor, animationDuration: '8s' }} />
          <span>ASTRAL // WAX</span>
        </div>

        <div className="flex items-center gap-2">
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
            <Disc className="h-4 w-4" /> PS2 PHYSICAL SHELF
          </button>
        </div>
      </nav>

      {/* Active Page Content */}
      {activePage === 'stats' ? <StatsDashboard /> : <PS2ShelfView />}
    </div>
  )
}