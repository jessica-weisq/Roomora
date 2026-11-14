import { useState } from 'react'
import { Icon } from './Icon'

/** Shows the photo, or an icon if the browser can't display it (e.g. HEIC). */
export function PhotoThumb({ url, alt, ratio = '4 / 3', iconSize = 26 }: { url?: string; alt: string; ratio?: string; iconSize?: number }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="thumb" style={{ aspectRatio: ratio }}>
      {url && !failed ? (
        <img src={url} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <Icon name="image" size={iconSize} strokeWidth={1.75} />
      )}
    </div>
  )
}
