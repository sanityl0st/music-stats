// frontend/src/components/canvas/PS2ShelfView.tsx
import { useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text, Edges } from '@react-three/drei'
import * as THREE from 'three'
import { ps2Audio } from '../../utils/ps2Audio'
import { Disc, ExternalLink, Plus, Trash2, RotateCcw, Music } from 'lucide-react'

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
const ROW_VERTICAL_GAP = 2.6
const SPINE_HORIZONTAL_GAP = 0.42

function AlbumCaseMesh({
  item,
  index,
  isSelected,
  anySelected,
  onSelect,
}: {
  item: PhysicalAlbum
  index: number
  isSelected: boolean
  anySelected: boolean
  onSelect: (item: PhysicalAlbum) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  // Load cover art texture safely with fallback
  const coverTexture = useMemo(() => {
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    return loader.load(item.artwork_url)
  }, [item.artwork_url])

  // Realistic relative dimensions per physical format: [Depth (Front-to-Back), Height, Thickness (Spine)]
  const dims: [number, number, number] = useMemo(() => {
    if (item.format === 'VINYL') return [1.65, 1.65, 0.08]
    if (item.format === 'CASSETTE') return [0.75, 1.15, 0.18]
    return [1.25, 1.25, 0.13] // CD Jewel Case
  }, [item.format])

  const row = Math.floor(index / ITEMS_PER_ROW)
  const col = index % ITEMS_PER_ROW
  const shelfX = (col - (ITEMS_PER_ROW - 1) / 2) * SPINE_HORIZONTAL_GAP
  const shelfY = -row * ROW_VERTICAL_GAP + (dims[1] - 1.65) / 2
  const shelfZ = 0

  useFrame((state, delta) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime

    if (isSelected) {
      // Fly out to front-and-center of the camera, slowly spinning & bobbing
      const targetPos = new THREE.Vector3(
        state.camera.position.x - 1.15,
        state.camera.position.y + Math.sin(t * 2.2) * 0.07,
        3.35
      )
      groupRef.current.position.lerp(targetPos, 0.08)
      groupRef.current.rotation.y += delta * 0.75
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, Math.sin(t * 1.4) * 0.08, 0.08)
    } else {
      // Sit spine-out on the shelf; pull up and forward slightly when hovered
      const hoverLiftY = hovered && !anySelected ? 0.22 : 0
      const hoverPullZ = hovered && !anySelected ? 0.45 : 0
      const targetPos = new THREE.Vector3(shelfX, shelfY + hoverLiftY, shelfZ + hoverPullZ)

      groupRef.current.position.lerp(targetPos, 0.12)
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.12)
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.12)
    }
  })

  const spineColor = item.format === 'VINYL' ? '#1e1b18' : item.format === 'CD' ? '#0f172a' : '#27272a'

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
      {/* 6-sided Case Mesh: Front & Back show Album Art; Spine faces +Z on the shelf */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={dims} />
        <meshStandardMaterial attach="material-0" map={coverTexture} roughness={0.3} />
        <meshStandardMaterial attach="material-1" map={coverTexture} roughness={0.3} />
        <meshStandardMaterial attach="material-2" color={spineColor} roughness={0.6} />
        <meshStandardMaterial attach="material-3" color={spineColor} roughness={0.6} />
        <meshStandardMaterial attach="material-4" color={hovered ? '#14532d' : spineColor} roughness={0.4} />
        <meshStandardMaterial attach="material-5" color="#09090b" roughness={0.5} />

        {/* PS2 Resident Evil Green Wireframe Highlight on Hover */}
        {(hovered || isSelected) && <Edges scale={1.02} threshold={15} color="#4ade80" />}
      </mesh>

      {/* Spine Label Text */}
      <Text
        position={[0, 0, dims[2] / 2 + 0.006]}
        rotation={[0, 0, -Math.PI / 2]}
        fontSize={0.055}
        maxWidth={dims[1] - 0.15}
        color={hovered ? '#86efac' : '#d4d4d8'}
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
  const totalRows = Math.max(3, Math.ceil(items.length / ITEMS_PER_ROW) + 1)

  useFrame((state) => {
    // Subtle mouse horizontal pan + smooth vertical scroll down the infinite shelf
    const targetX = selectedItem ? 0 : state.pointer.x * 1.15
    const targetY = -scrollOffset + (selectedItem ? 0 : state.pointer.y * 0.25)
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, targetX, 0.06)
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, 0.08)
  })

  return (
    <group>
      <fog attach="fog" args={['#050806', 4, 14]} />
      <ambientLight intensity={0.45} color="#a7f3d0" />
      <spotLight position={[0, 3, 6]} intensity={22} angle={0.65} penumbra={0.8} color="#ecfdf5" />
      <pointLight position={[-3, -2, 3]} intensity={6} color="#22c55e" />

      {/* Render Wooden/Metal Shelf Planks for each row */}
      {Array.from({ length: totalRows }).map((_, rIdx) => (
        <group key={rIdx} position={[0, -rIdx * ROW_VERTICAL_GAP - 0.9, -0.1]}>
          {/* Horizontal Shelf Plank */}
          <mesh receiveShadow>
            <boxGeometry args={[6.4, 0.12, 1.9]} />
            <meshStandardMaterial color="#1c1917" roughness={0.85} metalness={0.2} />
            <Edges color="#292524" />
          </mesh>
          {/* Backboard */}
          <mesh position={[0, 1.25, -0.9]}>
            <boxGeometry args={[6.4, ROW_VERTICAL_GAP, 0.08]} />
            <meshStandardMaterial color="#0c0a09" roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* Render Physical Cases */}
      {items.map((item, idx) => (
        <AlbumCaseMesh
          key={item.id}
          item={item}
          index={idx}
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

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false)
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

  const maxScroll = Math.max(0, (Math.ceil(displayedItems.length / ITEMS_PER_ROW) - 1) * ROW_VERTICAL_GAP)

  const handleWheel = (e: React.WheelEvent) => {
    if (selectedItem) return
    setScrollOffset((prev) => Math.min(maxScroll, Math.max(0, prev + e.deltaY * 0.003)))
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
      className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-[#050806] font-mono text-emerald-400 select-none"
    >
      {/* PS2 CRT Scanline & Vignette Overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-20 opacity-25"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.65), rgba(0,0,0,0.65) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-20 shadow-[inset_0_0_120px_rgba(0,0,0,0.95)]" />

      {/* Top PS2 Biohazard Inventory Control Bar */}
      <div className="relative z-30 flex flex-wrap items-center justify-between gap-4 border-b border-emerald-900/80 bg-black/80 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Disc className="h-5 w-5 animate-spin text-emerald-400" />
          <span className="tracking-widest text-sm font-bold text-emerald-300">
            ARCHIVE // PHYSICAL MEDIA STORAGE [{displayedItems.length} ITEMS]
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Filter by Format */}
          <div className="flex items-center border border-emerald-800 bg-black/90 p-0.5">
            {(['ALL', 'VINYL', 'CD', 'CASSETTE'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => {
                  ps2Audio.playHover()
                  setFilterFormat(fmt)
                }}
                className={`px-2.5 py-1 transition ${
                  filterFormat === fmt ? 'bg-emerald-700 text-black font-bold' : 'text-emerald-400 hover:bg-emerald-950'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {/* Sort Mode */}
          <button
            onClick={() => {
              ps2Audio.playHover()
              setSortBy((s) => (s === 'ALPHA' ? 'FORMAT' : 'ALPHA'))
            }}
            className="border border-emerald-700 bg-black/90 px-3 py-1.5 text-emerald-300 hover:bg-emerald-900/50"
          >
            SORT: {sortBy === 'ALPHA' ? 'A-Z' : 'FORMAT'}
          </button>

          {/* Add Physical Album Button */}
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

      {/* 3D Infinite Shelf Canvas */}
      <Canvas shadows camera={{ position: [0, 0, 5.2], fov: 50 }}>
        <ShelfEnvironment
          items={displayedItems}
          scrollOffset={scrollOffset}
          selectedItem={selectedItem}
          onSelect={(item) => setSelectedItem(item)}
        />
      </Canvas>

      {/* Bottom HUD Prompt */}
      {!selectedItem && (
        <div className="pointer-events-none absolute bottom-5 left-6 z-30 border border-emerald-900/80 bg-black/85 px-4 py-2 text-xs text-emerald-400/90">
          [MOUSE] PAN CAMERA &amp; HOVER SPINE &nbsp;|&nbsp; [SCROLL] NAVIGATE SHELF LEVELS &nbsp;|&nbsp; [CLICK] EXAMINE ITEM
        </div>
      )}

      {/* PS2 Resident Evil "EXAMINE ITEM" Right Panel when an Album is Picked Off the Shelf */}
      {selectedItem && (
        <div className="absolute right-8 top-20 bottom-8 z-30 flex w-full max-w-md flex-col justify-between border-2 border-emerald-600/80 bg-black/90 p-6 text-emerald-300 shadow-[0_0_50px_rgba(16,185,129,0.25)] backdrop-blur-md">
          <div className="overflow-y-auto pr-2">
            <div className="flex items-center justify-between border-b border-emerald-800 pb-2 text-xs text-amber-400">
              <span>ITEM EXAMINATION // FORMAT: {selectedItem.format}</span>
              <span>ID #{selectedItem.id.toString().padStart(3, '0')}</span>
            </div>

            <h2 className="mt-3 text-2xl font-bold tracking-wider text-white">{selectedItem.title}</h2>
            <p className="text-sm text-emerald-400">{selectedItem.artist}</p>

            {/* Streaming Links */}
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

            {/* Tracklist Inspection */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-bold tracking-widest text-amber-400">
                RECORDED TRACKLIST ({selectedItem.tracks.length} TRACKS)
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto border border-emerald-900/80 bg-black/60 p-3 text-xs">
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

          {/* Return to Shelf / Remove Buttons */}
          <div className="mt-4 flex gap-3 border-t border-emerald-800 pt-4 text-xs">
            <button
              onClick={() => {
                ps2Audio.playCancel()
                setSelectedItem(null)
              }}
              className="flex flex-1 items-center justify-center gap-2 border border-emerald-500 bg-emerald-900/40 py-2.5 font-bold text-white hover:bg-emerald-600 hover:text-black transition"
            >
              <RotateCcw className="h-4 w-4" /> RETURN TO SHELF
            </button>
            <button
              onClick={() => handleDelete(selectedItem.id)}
              className="flex items-center justify-center border border-red-600/80 bg-red-950/40 px-3 py-2.5 text-red-400 hover:bg-red-700 hover:text-white transition"
              title="Remove from Collection"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add Physical Album Modal */}
      {showAddModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <form
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