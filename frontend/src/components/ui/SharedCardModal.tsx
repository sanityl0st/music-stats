// frontend/src/components/ui/ShareCardModal.tsx
import { useState, useEffect, useRef } from 'react'
import { Dices, Download, X, Sparkles } from 'lucide-react'

interface ShareStatsProps {
  timeframeLabel: string
  totalMinutes: number
  topArtists: { name: string; minutes: number; play_count: number }[]
  topTracks: { title: string; artist: string; minutes: number }[]
  onClose: () => void
}

type CardStyle = 'cosmic' | 'ps2' | 'vinyl'

// Deterministic pseudo-random generator driven by the Reroll Seed
function seededRandom(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export default function ShareCardModal({
  timeframeLabel,
  totalMinutes,
  topArtists,
  topTracks,
  onClose,
}: ShareStatsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [style, setStyle] = useState<CardStyle>('cosmic')
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 999999))

  const reroll = () => setSeed(Math.floor(Math.random() * 999999))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rand = seededRandom(seed)
    const W = 1080
    const H = 1920
    ctx.clearRect(0, 0, W, H)

    if (style === 'cosmic') {
      // 1. COSMIC NEBULA PRESET
      const hues = [Math.floor(rand() * 360), Math.floor(rand() * 360), Math.floor(rand() * 360)]
      const grad = ctx.createLinearGradient(0, 0, W, H)
      grad.addColorStop(0, `hsl(${hues[0]}, 75%, 8%)`)
      grad.addColorStop(0.5, `hsl(${hues[1]}, 80%, 14%)`)
      grad.addColorStop(1, `hsl(${hues[2]}, 85%, 6%)`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      // Procedural Glowing Nebula Orbs
      for (let i = 0; i < 6; i++) {
        const x = rand() * W
        const y = rand() * H
        const r = 220 + rand() * 420
        const orbHull = ctx.createRadialGradient(x, y, 10, x, y, r)
        orbHull.addColorStop(0, `hsla(${Math.floor(rand() * 360)}, 95%, 60%, 0.38)`)
        orbHull.addColorStop(1, 'transparent')
        ctx.fillStyle = orbHull
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Starfield
      for (let i = 0; i < 180; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.8})`
        ctx.beginPath()
        ctx.arc(rand() * W, rand() * H, 1 + rand() * 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      // Glassmorphic Content Frame
      ctx.fillStyle = 'rgba(10, 8, 22, 0.62)'
      ctx.strokeStyle = `hsla(${hues[1]}, 90%, 70%, 0.5)`
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.roundRect(70, 110, W - 140, H - 220, 40)
      ctx.fill()
      ctx.stroke()

      // Typography
      ctx.fillStyle = `hsl(${hues[1]}, 95%, 75%)`
      ctx.font = 'bold 34px sans-serif'
      ctx.fillText(`ASTRAL // WAX — ${timeframeLabel.toUpperCase()}`, 130, 210)

      ctx.fillStyle = '#ffffff'
      ctx.font = '900 110px sans-serif'
      ctx.fillText(`${totalMinutes.toLocaleString()}`, 130, 355)
      ctx.font = 'bold 36px sans-serif'
      ctx.fillStyle = '#a1a1aa'
      ctx.fillText('TOTAL MINUTES STREAMED', 130, 415)
    } else if (style === 'ps2') {
      // 2. PS2 BIOHAZARD TERMINAL PRESET
      const palettes = [
        { bg: '#040a06', main: '#4ade80', accent: '#facc15' },
        { bg: '#0a0704', main: '#fb923c', accent: '#38bdf8' },
        { bg: '#050811', main: '#38bdf8', accent: '#f43f5e' },
      ]
      const pal = palettes[Math.floor(rand() * palettes.length)]
      ctx.fillStyle = pal.bg
      ctx.fillRect(0, 0, W, H)

      // Procedural CRT Scanlines & Radar Grid
      ctx.strokeStyle = `${pal.main}22`
      ctx.lineWidth = 2
      const gridStep = 60 + Math.floor(rand() * 40)
      for (let x = 0; x < W; x += gridStep) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
        ctx.stroke()
      }
      for (let y = 0; y < H; y += gridStep) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }

      // Outer Terminal Frame
      ctx.strokeStyle = pal.main
      ctx.lineWidth = 6
      ctx.strokeRect(70, 100, W - 140, H - 200)

      ctx.fillStyle = pal.accent
      ctx.font = 'bold 34px monospace'
      ctx.fillText(`SYS.TELEMETRY // ${timeframeLabel.toUpperCase()} [SEED #${seed}]`, 120, 195)

      ctx.fillStyle = pal.main
      ctx.font = 'bold 115px monospace'
      ctx.fillText(`${totalMinutes.toLocaleString()} MIN`, 120, 345)
      ctx.font = 'bold 32px monospace'
      ctx.fillStyle = '#d4d4d8'
      ctx.fillText('MEMORY CARD SLOT 1 // VERIFIED AUDIO LOG', 120, 405)
    } else {
      // 3. VINYL SLEEVE MINIMALIST PRESET
      const bgColors = ['#f4f1ea', '#e5e5e5', '#fef3c7', '#e0f2fe', '#fce7f3']
      const inkColors = ['#18181b', '#0f172a', '#31102f', '#064e3b']
      const bg = bgColors[Math.floor(rand() * bgColors.length)]
      const ink = inkColors[Math.floor(rand() * inkColors.length)]
      const accent = `hsl(${Math.floor(rand() * 360)}, 85%, 50%)`

      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // Giant Vinyl Grooves Graphic in Top Right
      ctx.save()
      ctx.translate(W - 180, 340)
      for (let r = 60; r < 340; r += 18) {
        ctx.strokeStyle = r % 36 === 0 ? accent : ink
        ctx.lineWidth = r % 54 === 0 ? 6 : 2
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()

      ctx.strokeStyle = ink
      ctx.lineWidth = 8
      ctx.strokeRect(70, 90, W - 140, H - 180)

      ctx.fillStyle = ink
      ctx.font = '900 38px serif'
      ctx.fillText(`ASTRAL WAX PRESSING // ${timeframeLabel.toUpperCase()}`, 125, 195)

      ctx.fillStyle = accent
      ctx.font = '900 120px sans-serif'
      ctx.fillText(`${totalMinutes.toLocaleString()}`, 125, 345)
      ctx.fillStyle = ink
      ctx.font = 'bold 34px monospace'
      ctx.fillText('MINUTES PLAYED ON RECORD', 125, 405)
    }

    // --- DRAW TOP 5 ARTISTS & TOP 5 SONGS ---
    const isLight = style === 'vinyl'
    const headingColor = isLight ? '#18181b' : '#f472b6'
    const textColor = isLight ? '#09090b' : '#ffffff'
    const subColor = isLight ? '#52525b' : '#a1a1aa'
    const fontName = style === 'ps2' ? 'monospace' : 'sans-serif'

    // Top Artists Section
    ctx.fillStyle = headingColor
    ctx.font = `bold 40px ${fontName}`
    ctx.fillText('TOP ARTISTS', 130, 540)

    topArtists.slice(0, 5).forEach((artist, idx) => {
      const y = 625 + idx * 95
      ctx.fillStyle = textColor
      ctx.font = `bold 44px ${fontName}`
      ctx.fillText(`0${idx + 1}. ${artist.name.slice(0, 22)}`, 130, y)

      ctx.fillStyle = subColor
      ctx.font = `bold 32px ${fontName}`
      ctx.fillText(`${artist.minutes}m`, W - 260, y)
    })

    // Top Songs Section
    ctx.fillStyle = headingColor
    ctx.font = `bold 40px ${fontName}`
    ctx.fillText('TOP TRACKS', 130, 1180)

    topTracks.slice(0, 5).forEach((track, idx) => {
      const y = 1265 + idx * 95
      ctx.fillStyle = textColor
      ctx.font = `bold 40px ${fontName}`
      ctx.fillText(`0${idx + 1}. ${track.title.slice(0, 24)}`, 130, y)

      ctx.fillStyle = subColor
      ctx.font = `28px ${fontName}`
      ctx.fillText(track.artist.slice(0, 28), 205, y + 34)
    })

    // Footer Watermark
    ctx.fillStyle = subColor
    ctx.font = `bold 26px ${fontName}`
    ctx.fillText('GENERATED VIA ASTRAL // WAX', 130, H - 145)
  }, [style, seed, timeframeLabel, totalMinutes, topArtists, topTracks])

  const handleDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `astral-wax-${style}-${seed}.png`
    a.click()
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-3xl flex-col md:flex-row gap-6 rounded-3xl border border-white/20 bg-zinc-950 p-6 text-white shadow-2xl"
      >
        {/* Left Preview Column */}
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-black/60 p-3 border border-white/10">
          <canvas
            ref={canvasRef}
            width={1080}
            height={1920}
            className="h-[420px] sm:h-[500px] w-auto rounded-xl shadow-lg"
          />
        </div>

        {/* Right Controls Column */}
        <div className="flex flex-1 flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black tracking-wide flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-400" /> Shareable Wrapped Card
              </h3>
              <button onClick={onClose} className="text-zinc-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Choose one of the 3 visual aesthetics below and hit Reroll to procedurally generate new colors, layouts, and seeds.
            </p>

            {/* 3 Style Options */}
            <div className="mt-5 space-y-2.5 text-xs">
              <label className="block font-bold text-zinc-300">1. SELECT GRAPHIC STYLE</label>
              {(
                [
                  ['cosmic', 'Option 1: Cosmic Nebula (Space Orbs & Starfield)'],
                  ['ps2', 'Option 2: PS2 Biohazard Terminal (CRT Grid)'],
                  ['vinyl', 'Option 3: Vinyl Sleeve Minimalist (Editorial Print)'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStyle(key)}
                  className={`w-full rounded-xl border px-4 py-3 text-left font-bold transition ${
                    style === key
                      ? 'border-purple-400 bg-purple-950/50 text-white'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Reroll Button */}
            <div className="mt-5">
              <label className="block mb-2 text-xs font-bold text-zinc-300">
                2. REROLL PROCEDURAL VARIATION (SEED #{seed})
              </label>
              <button
                onClick={reroll}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-950/40 py-3 text-xs font-bold text-cyan-200 hover:bg-cyan-900/60 transition"
              >
                <Dices className="h-4 w-4" /> Reroll Graphic Colors &amp; Pattern
              </button>
            </div>
          </div>

          <button
            onClick={handleDownload}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-sm font-black text-black hover:bg-zinc-200 transition"
          >
            <Download className="h-4 w-4" /> Download High-Res PNG (1080x1920)
          </button>
        </div>
      </div>
    </div>
  )
}