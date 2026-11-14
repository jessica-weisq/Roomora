// Marzipano ships without TypeScript types. This covers only what Panorama.tsx uses.
declare module 'marzipano' {
  interface ViewParams {
    yaw?: number
    pitch?: number
    fov?: number
  }
  type Limiter = (params: ViewParams) => ViewParams
  export class RectilinearView {
    constructor(params?: ViewParams, limiter?: Limiter)
    static limit: { traditional(maxResolution: number, maxVFov: number, maxHFov?: number): Limiter }
    setYaw(yaw: number): void
    setFov(fov: number): void
  }
  export class EquirectGeometry {
    constructor(levels: { width: number }[])
  }
  export class ImageUrlSource {
    static fromString(url: string): ImageUrlSource
  }
  export interface Scene {
    switchTo(opts?: { transitionDuration?: number }): void
    view(): RectilinearView
  }
  export class Viewer {
    constructor(element: HTMLElement, opts?: Record<string, unknown>)
    createScene(opts: { source: ImageUrlSource; geometry: EquirectGeometry; view: RectilinearView; pinFirstLevel?: boolean }): Scene
    updateSize(): void
    destroy(): void
  }
  const Marzipano: {
    Viewer: typeof Viewer
    RectilinearView: typeof RectilinearView
    EquirectGeometry: typeof EquirectGeometry
    ImageUrlSource: typeof ImageUrlSource
  }
  export default Marzipano
}
