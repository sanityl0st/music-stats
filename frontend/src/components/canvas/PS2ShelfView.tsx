// frontend/src/components/canvas/PS2ShelfView.tsx
import { useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text, Edges } from '@react-three/drei'
import * as THREE from 'three'
import { ps2Audio } from '../../utils/ps2Audio'
import { Disc, ExternalLink, Plus, Trash2, /*RotateCcw,*/ Music, /*Layers*/ } from 'lucide-react'

export interface PhysicalAlbum {
  id: number
  title: string
  artist: string
  format: 'VINYL' | 'CD' | 'CASSETTE'
  artwork_url: string
  apple_music_url: string
  spotify_url: string
  tracks: { number: number; title: string; duration: string }[]
}

const ITEMS_PER_ROW = 12
const ROW_VERTICAL_GAP = 2.4
const SPINE_HORIZONTAL_GAP = 0.44

// Shared texture cache so 200+ items don't create 200 redundant WebGL textures
const textureCache = new Map<string, THREE.Texture>()
const textureLoader = new THREE.TextureLoader()
textureLoader.setCrossOrigin('anonymous')

function getCachedTexture(url: string): THREE.Texture {
  if (!textureCache.has(url)) {
    const tex = textureLoader.load(url)
    tex.colorSpace = THREE.SRGBColorSpace
    textureCache.set(url, tex)
  }
  return textureCache.get(url)!
}

function AlbumCaseMesh({
  item,
  index,
  scrollOffset,
  isSelected,
  anySelected,
  onSelect,
}: {
  item: PhysicalAlbum
  index: number
  scrollOffset: number
  isSelected: boolean
  anySelected: boolean
  onSelect: (item: PhysicalAlbum) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  // Dimensions: [X = Narrow Spine Width, Y = Case Height, Z = Wide Cover Depth]
  const dims: [number, number, number] = useMemo(() => {
    if (item.format === 'VINYL') return [0.11, 1.65, 1.65]
    if (item.format === 'CASSETTE') return [0.22, 1.12, 0.78]
    return [0.15, 1.28, 1.28] // CD Jewel Case
  }, [item.format])

  const row = Math.floor(index / ITEMS_PER_ROW)
  const col = index % ITEMS_PER_ROW
  const shelfX = (col - (ITEMS_PER_ROW - 1) / 2) * SPINE_HORIZONTAL_GAP
  const shelfY = -row * ROW_VERTICAL_GAP + (dims[1] - 1.65) / 2
  const shelfZ = 0

  // Viewport culling: check if this row is visible near the current scroll position
  const currentRow = scrollOffset / ROW_VERTICAL_GAP
  const isNearViewport = Math.abs(row - currentRow) <= 3.5 || isSelected

  const coverTexture = useMemo(() => {
    if (!isNearViewport) return null
    return getCachedTexture(item.artwork_url)
  }, [item.artwork_url, isNearViewport])

  useFrame((state) => {
    if (!groupRef.current || !isNearViewport) return
    const t = state.clock.elapsedTime

    if (isSelected) {
      const xOffset = state.viewport.width < 5 ? 0 : -1.05
      const yOffset = state.viewport.width < 5 ? 0.5 : 0
      const targetPos = new THREE.Vector3(
        state.camera.position.x + xOffset,
        state.camera.position.y + yOffset + Math.sin(t * 2.0) * 0.06,
        3.25
      )
      groupRef.current.position.lerp(targetPos, 0.1)

      // Rotate -90 deg (-PI/2) so the +X Front Cover faces the camera directly, plus a slow inspection sway
      const targetRotY = -Math.PI / 2 + Math.sin(t * 0.75) * 0.45
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotY, 0.08)
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, Math.sin(t * 1.3) * 0.06, 0.08)
    } else {
      const hoverLiftY = hovered && !anySelected ? 0.24 : 0
      const hoverPullZ = hovered && !anySelected ? 0.52 : 0
      const targetPos = new THREE.Vector3(shelfX, shelfY + hoverLiftY, shelfZ + hoverPullZ)

      groupRef.current.position.lerp(targetPos, 0.14)
      // On shelf: rotation.y = 0 so +Z Spine faces camera directly
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.14)
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.14)
    }
  })

  if (!isNearViewport) return null

  const spineColor =
    item.format === 'VINYL' ? '#1c1917' : item.format === 'CD' ? '#0f172a' : '#27272a'

  return (
    <group
      ref={groupRef}
      position={[shelfX, shelfY, shelfZ]}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (!anySelected) {
          setHovered(true)
          ps2Audio.playHover()
          document.body.style.cursor = 'pointer'
        }
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (!anySelected) {
          ps2Audio.playSelect()
          onSelect(item)
        }
      }}
    >
      {/* BoxGeometry Face Mapping:
          material-0 (+X Right Face) = FRONT ALBUM COVER ARTWORK
          material-1 (-X Left Face)  = BACK ALBUM COVER ARTWORK
          material-2 (+Y Top Edge)   = Vinyl/CD Top Edge
          material-3 (-Y Bottom)     = Vinyl/CD Bottom Edge
          material-4 (+Z Front Face) = SPINE (Solid color + Spine Text facing the user on shelf)
          material-5 (-Z Back Edge)  = Inner Sleeve */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={dims} />
        <meshStandardMaterial attach="material-0" map={coverTexture} roughness={0.25} metalness={0.05} />
        <meshStandardMaterial attach="material-1" map={coverTexture} roughness={0.25} metalness={0.05} />
        <meshStandardMaterial attach="material-2" color="#d4d4d8" roughness={0.6} />
        <meshStandardMaterial attach="material-3" color="#27272a" roughness={0.6} />
        <meshStandardMaterial attach="material-4" color={hovered ? '#065f46' : spineColor} roughness={0.35} />
        <meshStandardMaterial attach="material-5" color="#18181b" roughness={0.5} />

        <Edges
          scale={1.01}
          threshold={15}
          color={hovered || isSelected ? '#4ade80' : '#3f3f46'}
        />
      </mesh>

      {/* Spine Text sits exclusively on the narrow +Z spine face */}
      <Text
        position={[0, 0, dims[2] / 2 + 0.008]}
        rotation={[0, 0, -Math.PI / 2]}
        fontSize={0.052}
        maxWidth={dims[1] - 0.14}
        color={hovered ? '#ffffff' : '#a7f3d0'}
        anchorX="center"
        anchorY="middle"
      >
        {`${item.artist.toUpperCase()} - ${item.title.toUpperCase()}`.slice(0, 28)}
      </Text>
    </group>
  )
}

function ShelfEnvironment({
  items,
  scrollOffset,
  selectedItem,
  onSelect,
}: {
  items: PhysicalAlbum[]
  scrollOffset: number
  selectedItem: PhysicalAlbum | null
  onSelect: (item: PhysicalAlbum) => void
}) {
  const flashlightRef = useRef<THREE.PointLight>(null)
  const rigLightRef = useRef<THREE.DirectionalLight>(null)
  const totalRows = Math.max(3, Math.ceil(items.length / ITEMS_PER_ROW))

  useFrame((state) => {
    const targetX = selectedItem ? 0 : state.pointer.x * 1.15
    const targetY = -scrollOffset + (selectedItem ? 0 : state.pointer.y * 0.22)
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, targetX, 0.07)
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, 0.09)

    // Move main key light with the camera so Row 20 is just as bright as Row 1
    if (rigLightRef.current) {
      rigLightRef.current.position.set(state.camera.position.x + 2, state.camera.position.y + 3, 7)
    }

    // Resident Evil cursor flashlight tracks mouse & vertical scroll
    if (flashlightRef.current) {
      flashlightRef.current.position.set(
        state.camera.position.x + state.pointer.x * 3.5,
        state.camera.position.y + state.pointer.y * 2.5,
        3.8
      )
    }
  })

  return (
    <group>
      {/* High-Visibility PS2 / Resident Evil Safe-Room Lighting */}
      <fog attach="fog" args={['#07120c', 7, 22]} />
      <ambientLight intensity={1.9} color="#ecfdf5" />
      <hemisphereLight args={['#a7f3d0', '#1c1917', 1.6]} />
      <directionalLight ref={rigLightRef} position={[2, 3, 7]} intensity={3.2} color="#ffffff" />
      <pointLight ref={flashlightRef} intensity={18} distance={10} decay={1.4} color="#fef08a" />

      {/* Render Shelf Planks for every row */}
      {Array.from({ length: totalRows }).map((_, rIdx) => (
        <group key={rIdx} position={[0, -rIdx * ROW_VERTICAL_GAP - 0.9, -0.1]}>
          {/* Shelf Horizontal Plank */}
          <mesh receiveShadow>
            <boxGeometry args={[6.4, 0.14, 1.95]} />
            <meshStandardMaterial color="#292524" roughness={0.7} metalness={0.2} />
            <Edges color="#10b981" />
          </mesh>
          {/* Shelf Row Number Tag on the Left Frame */}
          <Text
            position={[-3.05, 0.25, 0.88]}
            fontSize={0.11}
            color="#34d399"
            anchorX="left"
            anchorY="middle"
          >
            {`LVL-${String(rIdx + 1).padStart(2, '0')}`}
          </Text>
          {/* Shelf Backboard */}
          <mesh position={[0, 1.15, -0.95]}>
            <boxGeometry args={[6.4, ROW_VERTICAL_GAP, 0.08]} />
            <meshStandardMaterial color="#0c130f" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {items.map((item, idx) => (
        <AlbumCaseMesh
          key={item.id}
          item={item}
          index={idx}
          scrollOffset={scrollOffset}
          isSelected={selectedItem?.id === item.id}
          anySelected={Boolean(selectedItem)}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}

export default function PS2ShelfView() {
  const [items, setItems] = useState<PhysicalAlbum[]>([])
  const [selectedItem, setSelectedItem] = useState<PhysicalAlbum | null>(null)
  const [sortBy, setSortBy] = useState<'ALPHA' | 'FORMAT'>('ALPHA')
  const [filterFormat, setFilterFormat] = useState<'ALL' | 'VINYL' | 'CD' | 'CASSETTE'>('ALL')
  const [scrollOffset, setScrollOffset] = useState(0)
  //const [isBulkSeeding, setIsBulkSeeding] = useState(false)

  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  //const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [newArtist, setNewArtist] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newFormat, setNewFormat] = useState<'VINYL' | 'CD' | 'CASSETTE'>('VINYL')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchCollection = async () => {
    const res = await fetch('/api/collection')
    const data = await res.json()
    setItems(data)
  }

  useEffect(() => {
    fetchCollection()
  }, [])

  const displayedItems = useMemo(() => {
    return items
      .filter((i) => filterFormat === 'ALL' || i.format === filterFormat)
      .sort((a, b) => {
        if (sortBy === 'FORMAT') {
          return a.format.localeCompare(b.format) || a.title.localeCompare(b.title)
        }
        return a.title.localeCompare(b.title)
      })
  }, [items, sortBy, filterFormat])

  const totalRows = Math.max(1, Math.ceil(displayedItems.length / ITEMS_PER_ROW))
  const maxScroll = Math.max(0, (totalRows - 1) * ROW_VERTICAL_GAP)
  const currentRowIndex = Math.min(totalRows, Math.round(scrollOffset / ROW_VERTICAL_GAP) + 1)

  const handleWheel = (e: React.WheelEvent) => {
    if (selectedItem) return
    setScrollOffset((prev) => Math.min(maxScroll, Math.max(0, prev + e.deltaY * 0.0035)))
  }


  const handleClearAll = async () => {
    ps2Audio.playCancel()
    await fetch('/api/collection/clear/all', { method: 'DELETE' })
    setScrollOffset(0)
    setSelectedItem(null)
    await fetchCollection()
  }

  const handleAddAlbum = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newArtist.trim() || !newTitle.trim()) return
    setIsSubmitting(true)
    ps2Audio.playSelect()
    try {
      await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: newArtist, title: newTitle, format: newFormat }),
      })
      setNewArtist('')
      setNewTitle('')
      setShowAddModal(false)
      await fetchCollection()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    ps2Audio.playCancel()
    await fetch(`/api/collection/${id}`, { method: 'DELETE' })
    setSelectedItem(null)
    await fetchCollection()
  }

  return (
    <div
      onWheel={handleWheel}
      className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-[#07120c] font-mono text-emerald-400 select-none"
    >
      {/* PS2 CRT Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 z-20 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.65), rgba(0,0,0,0.65) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* Top Inventory Control Bar */}
      <div className="relative z-30 flex flex-wrap items-center justify-between gap-3 border-b border-emerald-900/80 bg-black/85 px-4 sm:px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <Disc className="h-5 w-5 animate-spin text-emerald-400" />
          <span className="tracking-widest text-xs sm:text-sm font-bold text-emerald-300">
            COLLECTION // ARCHIVE [{displayedItems.length} ITEMS | {totalRows} SHELVES]
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Format Filter */}
          <div className="flex items-center border border-emerald-800 bg-black/90 p-0.5">
            {(['ALL', 'VINYL', 'CD', 'CASSETTE'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => {
                  ps2Audio.playHover()
                  setFilterFormat(fmt)
                  setScrollOffset(0)
                }}
                className={`px-2 py-1 transition ${
                  filterFormat === fmt ? 'bg-emerald-700 text-black font-bold' : 'text-emerald-400 hover:bg-emerald-950'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              ps2Audio.playHover()
              setSortBy((s) => (s === 'ALPHA' ? 'FORMAT' : 'ALPHA'))
            }}
            className="border border-emerald-700 bg-black/90 px-2.5 py-1.5 text-emerald-300 hover:bg-emerald-900/50"
          >
            SORT: {sortBy === 'ALPHA' ? 'A-Z' : 'FORMAT'}
          </button>
        

          {items.length > 0 && (
            <button
              onClick={handleClearAll}
              className="border border-red-800/80 bg-red-950/40 px-2.5 py-1.5 text-red-400 hover:bg-red-800 hover:text-white transition"
            >
              CLEAR
            </button>
          )}

          <button
            onClick={() => {
              ps2Audio.playSelect()
              setShowAddModal(true)
            }}
            className="flex items-center gap-1.5 border border-emerald-500 bg-emerald-950/90 px-3 py-1.5 font-bold text-emerald-200 hover:bg-emerald-700 hover:text-black transition"
          >
            <Plus className="h-4 w-4" /> ADD MEDIA
          </button>
        </div>
      </div>

      {/* Left Vertical Shelf Level Scrubber (For fast navigation through 200+ items) */}
      {totalRows > 1 && !selectedItem && (
        <div className="absolute left-4 top-20 bottom-16 z-30 flex flex-col items-center justify-between border border-emerald-800/80 bg-black/85 px-2 py-3 text-[11px]">
          <span className="font-bold text-amber-400">LVL {String(currentRowIndex).padStart(2, '0')}</span>
          <input
            type="range"
            min={0}
            max={maxScroll}
            step={0.1}
            value={scrollOffset}
            onChange={(e) => setScrollOffset( parseFloat(e.target.value) )}
            className="h-full w-1.5 accent-emerald-400 cursor-pointer [writing-mode:vertical-lr]"
          />
          <span className="text-emerald-600">/{String(totalRows).padStart(2, '0')}</span>
        </div>
      )}

      {/* 3D Infinite Shelf Canvas */}
      <Canvas shadows camera={{ position: [0, 0, 5.2], fov: 50 }}>
        <ShelfEnvironment
          items={displayedItems}
          scrollOffset={scrollOffset}
          selectedItem={selectedItem}
          onSelect={(item) => setSelectedItem(item)}
        />
      </Canvas>

      {!selectedItem && (
        <div className="pointer-events-none absolute bottom-4 left-16 right-4 sm:right-auto z-30 border border-emerald-900/80 bg-black/85 px-3 py-2 text-[11px] sm:text-xs text-emerald-400/90">
          [MOUSE] FLASHLIGHT &amp; HOVER SPINE &nbsp;|&nbsp; [SCROLL / SLIDER] NAVIGATE {totalRows} SHELF LEVELS &nbsp;|&nbsp; [CLICK] EXAMINE COVER
        </div>
      )}

      {/* Item Examination Panel */}
      {selectedItem && (
        <div className="absolute inset-x-4 bottom-4 top-auto max-h-[58vh] md:inset-x-auto md:right-8 md:top-20 md:bottom-8 md:max-h-none z-30 flex w-auto md:w-full md:max-w-md flex-col justify-between border-2 border-emerald-600/80 bg-black/90 p-5 sm:p-6 text-emerald-300 shadow-[0_0_50px_rgba(16,185,129,0.25)] backdrop-blur-md">
          <div className="overflow-y-auto pr-2">
            <div className="flex items-center justify-between border-b border-emerald-800 pb-2 text-xs text-amber-400">
              <span>ITEM EXAMINATION // FORMAT: {selectedItem.format}</span>
              <span>ID #{selectedItem.id.toString().padStart(3, '0')}</span>
            </div>

            <h2 className="mt-3 text-xl sm:text-2xl font-bold tracking-wider text-white">{selectedItem.title}</h2>
            <p className="text-sm text-emerald-400">{selectedItem.artist}</p>

            <div className="mt-4 flex gap-3 text-xs">
              <a
                href={selectedItem.apple_music_url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 border border-pink-500/60 bg-pink-950/40 py-2 text-pink-300 hover:bg-pink-900/60"
              >
                <Music className="h-3.5 w-3.5" /> APPLE MUSIC <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={selectedItem.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 border border-emerald-500/60 bg-emerald-950/40 py-2 text-emerald-300 hover:bg-emerald-900/60"
              >
                <Disc className="h-3.5 w-3.5" /> SPOTIFY <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-bold tracking-widest text-amber-400">
                RECORDED TRACKLIST ({selectedItem.tracks.length} TRACKS)
              </div>
              <div className="max-h-40 md:max-h-64 space-y-1.5 overflow-y-auto border border-emerald-900/80 bg-black/60 p-3 text-xs">
                {selectedItem.tracks.map((tr) => (
                  <div key={tr.number} className="flex justify-between border-b border-emerald-950/70 pb-1">
                    <span className="truncate pr-3">
                      <span className="text-emerald-600">{String(tr.number).padStart(2, '0')}.</span> {tr.title}
                    </span>
                    <span className="text-emerald-500">{tr.duration}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-3 border-t border-emerald-800 pt-4 text-xs">
            {confirmDeleteId === selectedItem.id ? (
              <div className="flex items-center gap-1.5 bg-red-950/90 border border-red-500 px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-red-200">DISCARD?</span>
                <button
                  onClick={() => {
                    handleDelete(selectedItem.id)
                    setConfirmDeleteId(null)
                  }}
                  className="bg-red-600 px-2 py-1 font-bold text-black hover:bg-red-400"
                >
                  YES
                </button>
                <button
                  onClick={() => {
                    ps2Audio.playCancel()
                    setConfirmDeleteId(null)
                  }}
                  className="border border-red-400 px-2 py-1 text-red-200 hover:bg-red-900"
                >
                  NO
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  ps2Audio.playHover()
                  setConfirmDeleteId(selectedItem.id)
                }}
                className="flex items-center justify-center border border-red-600/80 bg-red-950/40 px-3 py-2.5 text-red-400 hover:bg-red-700 hover:text-white transition"
                title="Remove from Collection"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add Physical Album Modal */}
      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddAlbum}
            className="w-full max-w-md border-2 border-emerald-600 bg-[#070d09] p-6 shadow-[0_0_40px_rgba(16,185,129,0.3)]"
          >
            <h3 className="border-b border-emerald-800 pb-2 text-lg font-bold tracking-widest text-emerald-300">
              REGISTER NEW PHYSICAL MEDIA
            </h3>
            <p className="mt-1 text-xs text-emerald-600">
              Cover art &amp; tracklist will be retrieved automatically from the catalog.
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block text-emerald-400 mb-1">ARTIST NAME</label>
                <input
                  type="text"
                  required
                  value={newArtist}
                  onChange={(e) => setNewArtist(e.target.value)}
                  placeholder="e.g. Deftones"
                  className="w-full border border-emerald-700 bg-black px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-emerald-400 mb-1">ALBUM TITLE</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. White Pony"
                  className="w-full border border-emerald-700 bg-black px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-emerald-400 mb-1">PHYSICAL FORMAT</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['VINYL', 'CD', 'CASSETTE'] as const).map((fmt) => (
                    <button
                      type="button"
                      key={fmt}
                      onClick={() => setNewFormat(fmt)}
                      className={`border py-2 font-bold ${
                        newFormat === fmt
                          ? 'border-emerald-400 bg-emerald-700 text-black'
                          : 'border-emerald-800 bg-black text-emerald-400'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 text-xs">
              <button
                type="button"
                onClick={() => {
                  ps2Audio.playCancel()
                  setShowAddModal(false)
                }}
                className="border border-emerald-800 px-4 py-2 text-emerald-400 hover:bg-emerald-950"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="border border-emerald-400 bg-emerald-600 px-5 py-2 font-bold text-black hover:bg-emerald-400"
              >
                {isSubmitting ? 'FETCHING CATALOG...' : 'ADD TO SHELF'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}