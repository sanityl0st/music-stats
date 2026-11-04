import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, Sparkles } from '@react-three/drei'
import * as THREE from 'three'

function GalaxyScene() {
  const planetRef = useRef<THREE.Mesh>(null)
  const ufoRef = useRef<THREE.Group>(null)
  const swirlRef = useRef<THREE.Points>(null)

  // Procedural multi-colored nebula swirl particles (magenta, orange, green, cyan)
  const { positions, colors } = useMemo(() => {
    const count = 3500
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const palette = [
      new THREE.Color('#ff2a85'), // Vibrant Pink/Magenta
      new THREE.Color('#ff7b00'), // Solar Orange
      new THREE.Color('#00ff66'), // Toxic Emerald
      new THREE.Color('#38bdf8'), // Atmosphere Cyan
      new THREE.Color('#a855f7'), // Deep Violet
    ]

    for (let i = 0; i < count; i++) {
      const radius = 3.5 + Math.random() * 9
      const angle = (i / count) * Math.PI * 12 + (Math.random() - 0.5) * 0.8
      pos[i * 3] = Math.cos(angle) * radius
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4.5
      pos[i * 3 + 2] = Math.sin(angle) * radius - 6

      const c = palette[Math.floor(Math.random() * palette.length)]
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    return { positions: pos, colors: col }
  }, [])

  useFrame((state, delta) => {
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * 0.06
    }
    if (swirlRef.current) {
      swirlRef.current.rotation.z += delta * 0.03
      swirlRef.current.rotation.y += delta * 0.015
    }
    if (ufoRef.current) {
      ufoRef.current.rotation.y += delta * 0.8
      ufoRef.current.position.y = 3.1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.15
    }
    // Subtle mouse parallax
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, state.pointer.x * 0.6, 0.05)
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, state.pointer.y * 0.3, 0.05)
  })

  return (
    <group>
      <Stars radius={80} depth={50} count={6000} factor={4} saturation={0.8} fade speed={1.2} />
      <Sparkles count={180} scale={14} size={3} speed={0.4} color="#f472b6" />

      {/* Swirling Nebula Particle Cloud */}
      <points ref={swirlRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.09} vertexColors transparent opacity={0.85} blending={THREE.AdditiveBlending} />
      </points>

      {/* Glowing Chromatic Planet on the Horizon */}
      <group position={[-0.6, -1.2, -7]}>
        <mesh ref={planetRef}>
          <sphereGeometry args={[3.9, 64, 64]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#be185d"
            emissiveIntensity={0.65}
            roughness={0.35}
            metalness={0.2}
          />
        </mesh>
        {/* Atmospheric Rim Halo */}
        <mesh scale={1.06}>
          <sphereGeometry args={[3.9, 64, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} side={THREE.BackSide} />
        </mesh>
      </group>

      {/* Glowing Ringed Saucer / UFO in Top Right */}
      <group ref={ufoRef} position={[3.6, 3.1, -4.5]} rotation={[0.45, 0, -0.35]}>
        <mesh>
          <cylinderGeometry args={[0.9, 1.3, 0.22, 32]} />
          <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.35, 0.08, 16, 64]} />
          <meshBasicMaterial color="#7dd3fc" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.75, 0.05, 16, 64]} />
          <meshBasicMaterial color="#e0f2fe" />
        </mesh>
      </group>

      {/* Lunar Surface Silhouette Foreground */}
      <mesh position={[0, -4.4, -2]} rotation={[-Math.PI / 2.2, 0, 0]}>
        <planeGeometry args={[28, 10, 48, 48]} />
        <meshStandardMaterial color="#0f172a" roughness={0.95} metalness={0.1} wireframe={false} />
      </mesh>

      <ambientLight intensity={0.4} />
      <pointLight position={[-4, 1, -4]} intensity={18} color="#ff2a85" />
      <pointLight position={[4, 3, -3]} intensity={14} color="#38bdf8" />
      <pointLight position={[0, 2, -3]} intensity={10} color="#22c55e" />
    </group>
  )
}

export default function CosmicBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none bg-[#05030a]">
      <Canvas camera={{ position: [0, 0, 6], fov: 55 }}>
        <GalaxyScene />
      </Canvas>
    </div>
  )
}