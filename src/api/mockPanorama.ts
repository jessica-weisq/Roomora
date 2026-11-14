// Draws a stand-in 360° image (2:1 equirectangular) so the 360° viewer works before the real
// panoramas exist. Only used by mock.ts.

const WALLS = ['#E9E2D6', '#DDE6EE', '#E6E0EC', '#DFEBE3', '#F0E4DA']

export async function mockPanorama(roomName: string, index: number): Promise<string> {
  const W = 2048
  const H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) return ''

  const horizon = H / 2
  const wallTop = H * 0.3
  const wallBottom = H * 0.68

  // Ceiling, walls, floor
  g.fillStyle = '#F7F7F5'
  g.fillRect(0, 0, W, wallTop)
  g.fillStyle = WALLS[index % WALLS.length]
  g.fillRect(0, wallTop, W, wallBottom - wallTop)
  g.fillStyle = '#B9A58C'
  g.fillRect(0, wallBottom, W, H - wallBottom)
  // Floorboards
  g.strokeStyle = 'rgba(0,0,0,0.08)'
  g.lineWidth = 2
  for (let y = wallBottom + 18; y < H; y += 18 + (y - wallBottom) * 0.15) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(W, y)
    g.stroke()
  }
  // Room corners every 90°
  g.strokeStyle = 'rgba(0,0,0,0.18)'
  g.lineWidth = 3
  for (let i = 0; i < 4; i++) {
    const x = (W / 4) * i + W / 8
    g.beginPath()
    g.moveTo(x, wallTop)
    g.lineTo(x, wallBottom)
    g.stroke()
  }
  // Skirting and cornice
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.fillRect(0, wallBottom - 10, W, 10)
  g.fillRect(0, wallTop, W, 6)
  // A window and a door
  g.fillStyle = '#BFD7EA'
  g.fillRect(W * 0.22, horizon - 120, 220, 170)
  g.strokeStyle = '#FFFFFF'
  g.lineWidth = 10
  g.strokeRect(W * 0.22, horizon - 120, 220, 170)
  g.fillStyle = '#A88B6A'
  g.fillRect(W * 0.7, wallTop + 40, 120, wallBottom - wallTop - 50)

  // Label, twice so you see it whichever way you face
  g.fillStyle = 'rgba(17,24,39,0.75)'
  g.textAlign = 'center'
  for (const x of [W * 0.5, W * 0.0 + 1, W - 1]) {
    g.font = '600 30px Inter, system-ui, sans-serif'
    g.fillText(roomName, x, horizon - 20)
    g.font = '400 18px Inter, system-ui, sans-serif'
    g.fillText('Mock 360° view: replace with the real panorama', x, horizon + 24)
  }

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
  return blob ? URL.createObjectURL(blob) : ''
}
