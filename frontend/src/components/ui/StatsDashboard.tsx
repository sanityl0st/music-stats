// frontend/src/components/ui/StatsDashboard.tsx
import { useState, useEffect } from 'react'
import { useThemeStore, type LayoutPreset, type FontPreset } from '../../store/useThemeStore'
import { Sliders, Upload, Sparkles, Clock, Disc, Music, User, RotateCcw } from 'lucide-react'

interface StatsData {
  timeframe: string
  total_streams: number
  total_minutes_listened: number
  total_hours_listened: number
  total_artists: number
  total_albums: number
  total_tracks: number
  top_artists: { id: number; name: string; artwork_url: string; play_count: number; minutes: number }[]
  top_albums: { id: number; title: string; artist: string; artwork_url: string; play_count: number; minutes: number }[]
  top_tracks: { id: number; title: string; artist: string; album: string; artwork_url: string; play_count: number; minutes: number }[]
  recent_streams: { id: number; track: string; artist: string; album: string; artwork_url: string; played_at: string }[]
}

export default function StatsDashboard() {
  const [timeframe, setTimeframe] = useState<'all' | 'month' | 'week'>('all')
  const [data, setData] = useState<StatsData | null>(null)
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)

  const theme = useThemeStore()

  const fetchStats = async (tf: string) => {
    const res = await fetch(`/api/stats/overview?timeframe=${tf}`)
    const json = await res.json()
    setData(json)
  }

  useEffect(() => {
    fetchStats(timeframe)
  }, [timeframe])

  const handleSeedMock = async () => {
    setIsSeeding(true)
    await fetch('/api/sync/seed-mock', { method: 'POST' })
    await fetchStats(timeframe)
    setIsSeeding(false)
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      theme.setTheme({ backgroundMode: 'photo', customPhotoUrl: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  const fontClass =
    theme.fontFamily === 'mono'
      ? 'font-mono'
      : theme.fontFamily === 'serif'
      ? 'font-serif'
      : 'font-sans'

  const layoutGridClass =
    theme.layout === 'bento'
      ? 'grid-cols-1 lg:grid-cols-3 gap-6'
      : theme.layout === 'classic'
      ? 'grid-cols-1 gap-6 max-w-4xl mx-auto'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'

  return (
    <div className={`min-h-screen px-6 py-8 text-white ${fontClass}`}>
      {/* Header Bar: Timeframe Recaps + Customize Button */}
      <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: theme.primaryColor }}>
            LISTENING TELEMETRY
          </h1>
          <p className="text-sm text-zinc-300">
            Lifetime, Monthly &amp; Weekly Apple Music Analytics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Timeframe Switcher (All-Time / Monthly Recap / Weekly Recap) */}
          <div
            className="flex rounded-xl p-1 border border-white/15 backdrop-blur-md"
            style={{ backgroundColor: theme.cardBgColor }}
          >
            {(
              [
                ['all', 'All-Time'],
                ['month', 'Monthly Recap'],
                ['week', 'Weekly Recap'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimeframe(key)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold transition"
                style={{
                  backgroundColor: timeframe === key ? theme.primaryColor : 'transparent',
                  color: timeframe === key ? '#09090b' : '#e4e4e7',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={handleSeedMock}
            disabled={isSeeding}
            className="flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold hover:bg-white/10 backdrop-blur-md transition"
            style={{ backgroundColor: theme.cardBgColor }}
          >
            <Sparkles className="h-4 w-4" style={{ color: theme.secondaryColor }} />
            {isSeeding ? 'Syncing...' : 'Seed Demo Data'}
          </button>

          <button
            onClick={() => setShowCustomizer(!showCustomizer)}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-black transition"
            style={{ backgroundColor: theme.secondaryColor }}
          >
            <Sliders className="h-4 w-4" /> Customize UI
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {data && (
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'MINUTES STREAMED', value: data.total_minutes_listened.toLocaleString(), icon: Clock },
              { label: 'HOURS LISTENED', value: data.total_hours_listened.toLocaleString(), icon: Sparkles },
              { label: 'UNIQUE ARTISTS', value: data.total_artists.toLocaleString(), icon: User },
              { label: 'UNIQUE TRACKS', value: data.total_tracks.toLocaleString(), icon: Music },
            ].map((stat, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-white/15 p-5 backdrop-blur-md shadow-xl"
                style={{ backgroundColor: theme.cardBgColor }}
              >
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{stat.label}</span>
                  <stat.icon className="h-4 w-4" style={{ color: theme.primaryColor }} />
                </div>
                <div className="mt-2 text-3xl font-black" style={{ color: theme.secondaryColor }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Customizable Leaderboard Grid */}
          <div className={`grid ${layoutGridClass}`}>
            {/* Top Artists */}
            <div
              className="rounded-2xl border border-white/15 p-6 backdrop-blur-md"
              style={{ backgroundColor: theme.cardBgColor }}
            >
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: theme.primaryColor }}>
                <User className="h-5 w-5" /> Top Artists
              </h2>
              <div className="space-y-3">
                {data.top_artists.slice(0, 8).map((artist, i) => (
                  <div key={artist.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-xs font-bold text-zinc-400">#{i + 1}</span>
                      <img
                        src={artist.artwork_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}
                        alt={artist.name}
                        className="h-10 w-10 rounded-full object-cover border border-white/20"
                      />
                      <span className="truncate font-semibold text-sm">{artist.name}</span>
                    </div>
                    <div className="text-right text-xs shrink-0">
                      <div className="font-bold" style={{ color: theme.secondaryColor }}>{artist.minutes}m</div>
                      <div className="text-zinc-400">{artist.play_count} plays</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Albums */}
            <div
              className="rounded-2xl border border-white/15 p-6 backdrop-blur-md"
              style={{ backgroundColor: theme.cardBgColor }}
            >
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: theme.primaryColor }}>
                <Disc className="h-5 w-5" /> Top Albums
              </h2>
              <div className="space-y-3">
                {data.top_albums.slice(0, 8).map((album, i) => (
                  <div key={album.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-xs font-bold text-zinc-400">#{i + 1}</span>
                      <img
                        src={album.artwork_url || 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=100'}
                        alt={album.title}
                        className="h-10 w-10 rounded-lg object-cover border border-white/20"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-sm">{album.title}</div>
                        <div className="truncate text-xs text-zinc-400">{album.artist}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs shrink-0">
                      <div className="font-bold" style={{ color: theme.secondaryColor }}>{album.minutes}m</div>
                      <div className="text-zinc-400">{album.play_count} plays</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Tracks */}
            <div
              className="rounded-2xl border border-white/15 p-6 backdrop-blur-md"
              style={{ backgroundColor: theme.cardBgColor }}
            >
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: theme.primaryColor }}>
                <Music className="h-5 w-5" /> Top Tracks
              </h2>
              <div className="space-y-3">
                {data.top_tracks.slice(0, 8).map((track, i) => (
                  <div key={track.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-xs font-bold text-zinc-400">#{i + 1}</span>
                      <img
                        src={track.artwork_url || 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=100'}
                        alt={track.title}
                        className="h-10 w-10 rounded-lg object-cover border border-white/20"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-sm">{track.title}</div>
                        <div className="truncate text-xs text-zinc-400">{track.artist}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs shrink-0">
                      <div className="font-bold" style={{ color: theme.secondaryColor }}>{track.minutes}m</div>
                      <div className="text-zinc-400">{track.play_count} plays</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Listening History */}
            <div
              className={`rounded-2xl border border-white/15 p-6 backdrop-blur-md ${
                theme.layout === 'bento' ? 'lg:col-span-3' : ''
              }`}
              style={{ backgroundColor: theme.cardBgColor }}
            >
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: theme.primaryColor }}>
                <Clock className="h-5 w-5" /> Recent Listening Stream History
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.recent_streams.slice(0, 9).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
                  >
                    <img
                      src={s.artwork_url || 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=100'}
                      alt={s.track}
                      className="h-11 w-11 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{s.track}</div>
                      <div className="truncate text-xs text-zinc-400">{s.artist}</div>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {new Date(s.played_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Theme & Layout Customizer Drawer */}
      {showCustomizer && (
        <div className="fixed right-6 top-20 z-50 w-80 rounded-2xl border border-white/20 bg-zinc-950/95 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="font-bold text-sm">Customize Dashboard</h3>
            <button onClick={() => theme.resetTheme()} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>

          <div className="mt-4 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span>Primary Accent Color</span>
              <input
                type="color"
                value={theme.primaryColor}
                onChange={(e) => theme.setTheme({ primaryColor: e.target.value })}
                className="h-7 w-12 cursor-pointer rounded bg-transparent"
              />
            </div>

            <div className="flex items-center justify-between">
              <span>Secondary Highlight</span>
              <input
                type="color"
                value={theme.secondaryColor}
                onChange={(e) => theme.setTheme({ secondaryColor: e.target.value })}
                className="h-7 w-12 cursor-pointer rounded bg-transparent"
              />
            </div>

            <div>
              <label className="block mb-1 text-zinc-400">Layout Preset</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['bento', 'classic', 'compact'] as LayoutPreset[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => theme.setTheme({ layout: l })}
                    className={`rounded-lg py-1.5 capitalize border ${
                      theme.layout === l ? 'border-white bg-white/20 font-bold' : 'border-white/10'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block mb-1 text-zinc-400">Typography</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['sans', 'mono', 'serif'] as FontPreset[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => theme.setTheme({ fontFamily: f })}
                    className={`rounded-lg py-1.5 capitalize border ${
                      theme.fontFamily === f ? 'border-white bg-white/20 font-bold' : 'border-white/10'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block mb-1 text-zinc-400">Background Environment</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => theme.setTheme({ backgroundMode: 'space3d' })}
                  className={`rounded-lg py-2 border ${
                    theme.backgroundMode === 'space3d' ? 'border-purple-400 bg-purple-950/50 font-bold' : 'border-white/10'
                  }`}
                >
                  3D Galaxy
                </button>
                <label className="flex items-center justify-center gap-1 rounded-lg py-2 border border-white/10 cursor-pointer hover:bg-white/10">
                  <Upload className="h-3.5 w-3.5" /> Photo
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}