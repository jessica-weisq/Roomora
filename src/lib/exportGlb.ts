import type { Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/** Export a three.js object as a binary .glb and start a download. */
export async function downloadGlb(object: Object3D, filename = 'model.glb') {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(object, { binary: true, onlyVisible: true })
  const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
