// frontend/src/utils/ps2Audio.ts
class PS2SoundEngine {
  private ctx: AudioContext | null = null
  private customSounds: Record<string, HTMLAudioElement> = {}

  constructor() {
    if (typeof window !== 'undefined') {
      // Maps directly to frontend/public/sfx/*.mp3
      this.customSounds = {
        hover: new Audio('/sfx/hover.mp3'),
        select: new Audio('/sfx/select.mp3'),
        cancel: new Audio('/sfx/cancel.mp3'),
      }
      Object.values(this.customSounds).forEach((audio) => {
        audio.volume = 0.45
      })
    }
  }

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
  }

  private tryPlayFile(key: 'hover' | 'select' | 'cancel', fallbackFn: () => void) {
    const sound = this.customSounds[key]
    if (sound) {
      const clone = sound.cloneNode() as HTMLAudioElement
      clone.volume = sound.volume
      clone.play().catch(() => fallbackFn())
    } else {
      fallbackFn()
    }
  }

  playHover() {
    this.tryPlayFile('hover', () => {
      this.init()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.045)
      gain.gain.setValueAtTime(0.06, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.05)
    })
  }

  playSelect() {
    this.tryPlayFile('select', () => {
      this.init()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      ;[440, 554.37, 659.25, 880].forEach((f, idx) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(f, now + idx * 0.03)
        gain.gain.setValueAtTime(0.08, now + idx * 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.55)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now + idx * 0.03)
        osc.stop(now + 0.55)
      })
    })
  }

  playCancel() {
    this.tryPlayFile('cancel', () => {
      this.init()
      if (!this.ctx) return
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(280, now)
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.16)
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.17)
    })
  }
}

export const ps2Audio = new PS2SoundEngine()