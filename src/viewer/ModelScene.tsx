import { Suspense, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { Ref, RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Plan, Room } from '../api/types'
import { useTheme } from '../state/theme'

export interface SceneHandle {
  zoom: (factor: number) => void
  reset: () => void
  /** The group holding the model, for exporting to .glb */
  getModel: () => THREE.Object3D | null
}

interface Props {
  plan: Plan
  modelUrl: string | null
  selected: string | null
  onSelect: (roomId: string) => void
  handle: Ref<SceneHandle>
  /** A div laid over the canvas that room labels render into (keeps them outside the canvas's own DOM). */
  labelLayer: RefObject<HTMLDivElement | null>
}

const WALL_T = 0.1
const WALL_H = 2.4
const INNER_H = 1.0
const FRONT_H = 0.25

const isWet = (r: Room) => /kitchen|bath|shower|wc|toilet|utility/i.test(r.name)

/** Wall pieces for one room: each edge inset by half a wall thickness, so neighbours sit side by side. */
function wallsFor(r: Room, plan: Plan) {
  const eps = 1e-6
  const h = WALL_T / 2
  const edges = [
    // [x, z, length, along X?, which side]
    { x: r.x + r.width / 2, z: r.y + h, len: r.width, alongX: true, ext: Math.abs(r.y) < eps, front: false },
    { x: r.x + r.width / 2, z: r.y + r.depth - h, len: r.width, alongX: true, ext: Math.abs(r.y + r.depth - plan.depth) < eps, front: true },
    { x: r.x + h, z: r.y + r.depth / 2, len: r.depth, alongX: false, ext: Math.abs(r.x) < eps, front: false },
    { x: r.x + r.width - h, z: r.y + r.depth / 2, len: r.depth, alongX: false, ext: Math.abs(r.x + r.width - plan.width) < eps, front: true },
  ]
  // Dollhouse cutaway: outside walls at the back are full height, outside walls facing the camera are cut low,
  // inside walls are half height so you can see into every room.
  return edges.map((e) => ({ ...e, height: e.ext ? (e.front ? FRONT_H : WALL_H) : INNER_H }))
}

function RoomMesh({ room, plan, selected, onSelect, labelLayer }: { room: Room; plan: Plan; selected: boolean; onSelect: (id: string) => void; labelLayer: RefObject<HTMLDivElement | null> }) {
  const floorColor = selected ? '#A9BED6' : isWet(room) ? '#D3DAE3' : '#DCCDB8'
  const walls = useMemo(() => wallsFor(room, plan), [room, plan])
  return (
    <group>
      <mesh
        position={[room.x + room.width / 2, 0.025, room.y + room.depth / 2]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation()
          onSelect(room.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <boxGeometry args={[room.width - 0.02, 0.05, room.depth - 0.02]} />
        <meshStandardMaterial color={floorColor} roughness={0.9} />
      </mesh>
      {walls.map((w, i) => (
        <mesh key={i} position={[w.x, w.height / 2 + 0.05, w.z]} castShadow receiveShadow>
          <boxGeometry args={w.alongX ? [w.len, w.height, WALL_T] : [WALL_T, w.height, w.len]} />
          <meshStandardMaterial color="#F4F4F2" roughness={0.95} />
        </mesh>
      ))}
      <Html position={[room.x + room.width / 2, 0.3, room.y + room.depth / 2]} center zIndexRange={[10, 0]} portal={labelLayer as RefObject<HTMLElement>}>
        <div className="room-label">{room.name}</div>
      </Html>
    </group>
  )
}

function PlanModel({ plan, selected, onSelect, labelLayer }: { plan: Plan; selected: string | null; onSelect: (id: string) => void; labelLayer: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      {plan.rooms.map((r) => (
        <RoomMesh key={r.id} room={r} plan={plan} selected={selected === r.id} onSelect={onSelect} labelLayer={labelLayer} />
      ))}
    </>
  )
}

const HIGHLIGHT = new THREE.Color('#547ba2')

function GltfModel({ url, selected, onSelect }: { url: string; selected: string | null; onSelect: (id: string) => void }) {
  const { scene } = useGLTF(url)
  // The backend's .glb uses metres, y up, origin at the floor plan's top-left corner (x right, z down
  // the page), like the plan. Its nodes are named "floor__<roomId>", "wall__<roomId>__<n>" and "scan__<roomId>"
  // ("__" because three.js strips ':' from node names).
  const floors = useMemo(() => {
    const found: Record<string, THREE.MeshStandardMaterial> = {}
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.side = THREE.DoubleSide // scans are single-sided surfaces seen from both sides
      if (mesh.name.startsWith('floor__')) {
        mesh.material = mat.clone() // own material, so highlighting one floor doesn't tint them all
        found[mesh.name.slice(7)] = mesh.material as THREE.MeshStandardMaterial
      }
    })
    return found
  }, [scene])

  useEffect(() => {
    for (const [id, mat] of Object.entries(floors)) {
      mat.emissive = id === selected ? HIGHLIGHT : new THREE.Color(0x000000)
      mat.emissiveIntensity = id === selected ? 0.45 : 0
    }
  }, [floors, selected])

  return (
    <primitive
      object={scene}
      onClick={(e: { stopPropagation: () => void; object: THREE.Object3D }) => {
        e.stopPropagation()
        let o: THREE.Object3D | null = e.object
        while (o && !/^(floor|scan|wall)__/.test(o.name)) o = o.parent
        if (o) onSelect(o.name.split('__')[1])
      }}
    />
  )
}

function Controls({ handle, plan, model }: { handle: Ref<SceneHandle>; plan: Plan; model: RefObject<THREE.Group | null> }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const size = Math.max(plan.width, plan.depth)
  const home = useMemo(() => new THREE.Vector3(size * 0.75, size * 0.85, size * 1.0), [size])

  useEffect(() => {
    camera.position.copy(home)
    controls.current?.target.set(0, 0, 0)
    controls.current?.update()
  }, [camera, home])

  useImperativeHandle(handle, () => ({
    zoom: (factor: number) => {
      const c = controls.current
      if (!c) return
      const offset = camera.position.clone().sub(c.target).multiplyScalar(factor)
      const len = THREE.MathUtils.clamp(offset.length(), size * 0.4, size * 4)
      camera.position.copy(c.target).add(offset.setLength(len))
      c.update()
    },
    reset: () => {
      camera.position.copy(home)
      controls.current?.target.set(0, 0, 0)
      controls.current?.update()
    },
    getModel: () => model.current,
  }))

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      maxPolarAngle={Math.PI / 2.1}
      minDistance={size * 0.4}
      maxDistance={size * 4}
    />
  )
}

export function ModelScene({ plan, modelUrl, selected, onSelect, handle, labelLayer }: Props) {
  const model = useRef<THREE.Group>(null)
  const dark = useTheme().resolved === 'dark'
  return (
    <Canvas shadows camera={{ fov: 40, near: 0.1, far: 200 }} dpr={[1, 2]}>
      {/* Matches --stage in styles.css. The model itself keeps its natural colours in dark mode. */}
      <color attach="background" args={[dark ? '#161A21' : '#EEF1F5']} />
      <hemisphereLight args={['#ffffff', '#c9ced6', 0.9]} />
      <directionalLight position={[8, 14, 10]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-12, 12, 12, -12, 0.5, 50]} />
      </directionalLight>
      {/* Centre the plan on the origin so orbiting feels natural */}
      <group ref={model} position={[-plan.width / 2, 0, -plan.depth / 2]}>
        {modelUrl ? (
          <Suspense fallback={null}>
            <GltfModel url={modelUrl} selected={selected} onSelect={onSelect} />
          </Suspense>
        ) : (
          <PlanModel plan={plan} selected={selected} onSelect={onSelect} labelLayer={labelLayer} />
        )}
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={dark ? 0.35 : 0.12} />
      </mesh>
      <Controls handle={handle} plan={plan} model={model} />
    </Canvas>
  )
}
