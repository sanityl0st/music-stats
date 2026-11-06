import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, Sparkles, Float, Trail } from '@react-three/drei'
import * as THREE from 'three'

//import { useGLTF } from '@react-three/drei'

// function CustomSpaceModel() {
//   const { scene } = useGLTF('/models/voyager.glb')
//   return <primitive object={scene} position={[-3, 1.5, -4]} scale={0.5} />
// }

// Custom GLSL Shader to recreate the vivid Green / Orange / Magenta / Blue glowing planet in the reference image
const planetVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const planetFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  // Simple 3D pseudo-noise for swirling continents & nebula bands
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + .1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 pos = vPosition * 0.85 + vec3(uTime * 0.04, 0.0, 0.0);
    float n1 = noise(pos * 1.5);
    float n2 = noise(pos * 3.5 + n1 * 2.0);

    // Chromatic palette matching the reference artwork
    vec3 deepOcean = vec3(0.03, 0.25, 0.55);
    vec3 neonGreen = vec3(0.05, 0.95, 0.25);
    vec3 solarOrange = vec3(1.0, 0.38, 0.05);
    vec3 cosmicMagenta = vec3(0.95, 0.15, 0.75);

    vec3 col = mix(deepOcean, neonGreen, smoothstep(0.32, 0.58, n1));
    col = mix(col, solarOrange, smoothstep(0.45, 0.72, n2) * (1.0 - vUv.y));
    col = mix(col, cosmicMagenta, smoothstep(0.55, 0.85, n1 * n2));

    // Bright Fresnel atmospheric rim glow
    float fresnel = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
    vec3 rimColor = mix(vec3(0.3, 0.85, 1.0), vec3(1.0, 0.6, 0.9), 1.0 - vUv.x);

    gl_FragColor = vec4(col + rimColor * fresnel * 1.4, 1.0);
  }
`

function AsteroidBelt() {
  const groupRef = useRef<THREE.Group>(null)
  const rocks = useMemo(() => {
    return Array.from({ length: 140 }, () => {
      const angle = Math.random() * Math.PI * 2
      const radius = 5.4 + Math.random() * 4.5
      return {
        position: [
          Math.cos(angle) * radius - 0.6,
          (Math.random() - 0.5) * 1.4 - 0.8,
          Math.sin(angle) * radius - 7,
        ] as [number, number, number],
        rotation: [Math.random() * Math.PI, Math.random() * Math.PI, 0] as [number, number, number],
        scale: 0.04 + Math.random() * 0.14,
      }
    })
  }, [])

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.04
      groupRef.current.rotation.z = 0.18
    }
  })

  return (
    <group ref={groupRef}>
      {rocks.map((rock, idx) => (
        <mesh key={idx} position={rock.position} rotation={rock.rotation} scale={rock.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#64748b" roughness={0.85} metalness={0.25} />
        </mesh>
      ))}
    </group>
  )
}

function DetailedMothershipUFO() {
  const ufoGroup = useRef<THREE.Group>(null)

  useFrame((state, delta) => {
    if (!ufoGroup.current) return
    ufoGroup.current.rotation.y += delta * 0.65
    ufoGroup.current.position.y = 2.85 + Math.sin(state.clock.elapsedTime * 1.4) * 0.14
  })

  return (
    <group ref={ufoGroup} position={[3.4, 2.85, -4.2]} rotation={[0.52, 0, -0.38]}>
      {/* Central Command Core */}
      <mesh>
        <cylinderGeometry args={[0.55, 0.85, 0.25, 32]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* Glowing Inner Turbine Ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.06, 16, 64]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>

      {/* Radial Structural Spokes (Matching the UFO underside in your reference image) */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh key={i} rotation={[0, (i * Math.PI) / 6, 0]}>
          <boxGeometry args={[2.7, 0.06, 0.09]} />
          <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}

      {/* Outer Metallic Hull Ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.38, 0.14, 20, 64]} />
        <meshStandardMaterial color="#1e293b" metalness={0.95} roughness={0.15} />
      </mesh>

      {/* Outer Blinding Neon Halo Ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <torusGeometry args={[1.42, 0.07, 16, 64]} />
        <meshBasicMaterial color="#e0f2fe" />
      </mesh>
    </group>
  )
}

function OrbitingSatellite() {
  const satRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (!satRef.current) return
    const t = state.clock.elapsedTime * 0.35
    satRef.current.position.x = Math.cos(t) * 5.2 - 0.5
    satRef.current.position.z = Math.sin(t) * 3.5 - 5.5
    satRef.current.position.y = Math.sin(t * 1.5) * 1.4 + 1.2
    satRef.current.rotation.y = -t
    satRef.current.rotation.z = 0.4
  })

  return (
    <group ref={satRef} scale={0.32}>
      {/* Gold Foil Bus Body */}
      <mesh>
        <cylinderGeometry args={[0.35, 0.35, 1.1, 8]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.9} roughness={0.25} />
      </mesh>
      {/* Left & Right Solar Panel Wings */}
      <mesh position={[-1.5, 0, 0]}>
        <boxGeometry args={[2.2, 0.04, 0.85]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.8} roughness={0.2} emissive="#1e3a8a" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[1.5, 0, 0]}>
        <boxGeometry args={[2.2, 0.04, 0.85]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.8} roughness={0.2} emissive="#1e3a8a" emissiveIntensity={0.4} />
      </mesh>
      {/* Dish Antenna */}
      <mesh position={[0, 0.75, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.45, 0.25, 16, 1, true]} />
        <meshStandardMaterial color="#e2e8f0" side={THREE.DoubleSide} metalness={0.7} />
      </mesh>
    </group>
  )
}

function ShootingComet() {
  const cometRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!cometRef.current) return
    const cycle = (state.clock.elapsedTime * 0.45) % 4
    cometRef.current.position.x = -6.5 + cycle * 2.2
    cometRef.current.position.y = 4.2 - cycle * 1.1
    cometRef.current.position.z = -5
  })

  return (
    <Trail width={0.45} length={8} color={new THREE.Color('#f472b6')} attenuation={(t) => t * t}>
      <mesh ref={cometRef} position={[-5, 3.2, -5]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </Trail>
  )
}

function GalaxyScene() {
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null)
  const moonRef = useRef<THREE.Mesh>(null)
  const swirlRef = useRef<THREE.Points>(null)

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  // Swirling Nebula Clouds
  const { positions, colors } = useMemo(() => {
    const count = 4500
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const palette = [
      new THREE.Color('#ff2a85'),
      new THREE.Color('#ff7b00'),
      new THREE.Color('#00ff66'),
      new THREE.Color('#38bdf8'),
      new THREE.Color('#a855f7'),
    ]

    for (let i = 0; i < count; i++) {
      const radius = 3.2 + Math.random() * 11
      const angle = (i / count) * Math.PI * 14 + (Math.random() - 0.5) * 0.9
      pos[i * 3] = Math.cos(angle) * radius
      pos[i * 3 + 1] = (Math.random() - 0.5) * 5.5
      pos[i * 3 + 2] = Math.sin(angle) * radius - 7

      const c = palette[Math.floor(Math.random() * palette.length)]
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    return { positions: pos, colors: col }
  }, [])

  useFrame((state, delta) => {
    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }
    if (swirlRef.current) {
      swirlRef.current.rotation.z += delta * 0.025
    }
    if (moonRef.current) {
      moonRef.current.rotation.y += delta * 0.12
    }
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, state.pointer.x * 0.65, 0.05)
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, state.pointer.y * 0.35, 0.05)
  })

  return (
    <group>
      <Stars radius={90} depth={60} count={7000} factor={4.5} saturation={0.9} fade speed={1.4} />
      <Sparkles count={240} scale={16} size={3.2} speed={0.4} color="#f472b6" />

      {/* Nebula Swirl Particles */}
      <points ref={swirlRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.085} vertexColors transparent opacity={0.85} blending={THREE.AdditiveBlending} />
      </points>

      {/* Main Chromatic Planet */}
      <group position={[-0.6, -1.1, -6.8]}>
        <mesh>
          <sphereGeometry args={[3.95, 64, 64]} />
          <shaderMaterial
            ref={shaderMatRef}
            vertexShader={planetVertexShader}
            fragmentShader={planetFragmentShader}
            uniforms={uniforms}
          />
        </mesh>
        {/* Outer Atmosphere Corona */}
        <mesh scale={1.08}>
          <sphereGeometry args={[3.95, 64, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} side={THREE.BackSide} />
        </mesh>
        {/* Blinding Sunrise Flare on Left Horizon */}
        <mesh position={[-3.3, 0.6, 1.5]}>
          <sphereGeometry args={[0.95, 32, 32]} />
          <meshBasicMaterial color="#fff1f2" transparent opacity={0.85} />
        </mesh>
      </group>

      {/* Cratered Secondary Moon */}
      <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.5}>
        <mesh ref={moonRef} position={[-4.5, 2.1, -6]}>
          <icosahedronGeometry args={[0.68, 3]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.9} metalness={0.15} flatShading />
        </mesh>
      </Float>

      <AsteroidBelt />
      <DetailedMothershipUFO />
      <OrbitingSatellite />
      <ShootingComet />

      {/* Rugged Cratered Moon Foreground Terrain */}
      <mesh position={[0, -4.3, -2]} rotation={[-Math.PI / 2.2, 0, 0]}>
        <planeGeometry args={[30, 12, 64, 64]} />
        <meshStandardMaterial color="#0f172a" roughness={0.95} metalness={0.15} />
      </mesh>

      <ambientLight intensity={0.65} />
      <directionalLight position={[-5, 3, 2]} intensity={3.2} color="#ff2a85" />
      <directionalLight position={[5, 5, 3]} intensity={2.5} color="#38bdf8" />
    </group>
  )
}

export default function CosmicBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none bg-[#040208]">
      <Canvas camera={{ position: [0, 0, 6], fov: 55 }}>
        <GalaxyScene />
      </Canvas>
    </div>
  )
}