// frontend/src/store/useThemeStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LayoutPreset = 'bento' | 'classic' | 'compact'
export type FontPreset = 'sans' | 'mono' | 'serif' | 'retro'

interface ThemeState {
  primaryColor: string
  secondaryColor: string
  cardBgColor: string
  fontFamily: FontPreset
  layout: LayoutPreset
  backgroundMode: 'space3d' | 'photo'
  customPhotoUrl: string
  setTheme: (partial: Partial<ThemeState>) => void
  resetTheme: () => void
}

const defaultTheme = {
  primaryColor: '#c084fc',    // Cosmic Purple
  secondaryColor: '#38bdf8',  // Cyan Ring Glow
  cardBgColor: 'rgba(15, 12, 28, 0.72)',
  fontFamily: 'sans' as FontPreset,
  layout: 'bento' as LayoutPreset,
  backgroundMode: 'space3d' as const,
  customPhotoUrl: '',
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...defaultTheme,
      setTheme: (partial) => set((state) => ({ ...state, ...partial })),
      resetTheme: () => set(defaultTheme),
    }),
    { name: 'vinyl-stats-theme' }
  )
)