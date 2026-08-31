import type mapboxgl from 'mapbox-gl'

const hasCustomStyle = Boolean(import.meta.env.VITE_MAPBOX_STYLE)

/**
 * Runtime NFS-Underground tint over the stock dark-v11 style: near-black
 * ground, deep purple water, asphalt-blue streets with an amber cast on
 * motorways, muted labels. Skipped entirely when a hand-built Studio style
 * is configured via VITE_MAPBOX_STYLE — that always wins.
 */
export function applyNeonStyle(map: mapboxgl.Map): void {
  if (hasCustomStyle) return
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    const { id, type } = layer
    try {
      if (type === 'background') {
        map.setPaintProperty(id, 'background-color', '#0b0e14')
      } else if (type === 'fill' && /water/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#140f2b')
      } else if (type === 'fill' && /building/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#121826')
      } else if (type === 'fill' && /land|landuse|landcover|national-park/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#0d1119')
      } else if (type === 'line' && /motorway|trunk/.test(id)) {
        map.setPaintProperty(id, 'line-color', '#7a5a22')
      } else if (type === 'line' && /primary|secondary|major/.test(id)) {
        map.setPaintProperty(id, 'line-color', '#39435c')
      } else if (type === 'line' && /road|street|minor|tertiary|tunnel|bridge|path|link/.test(id)) {
        map.setPaintProperty(id, 'line-color', '#232b3d')
      } else if (type === 'symbol') {
        map.setPaintProperty(id, 'text-color', '#98a2b8')
        map.setPaintProperty(id, 'text-halo-color', '#0b0e14')
      }
    } catch {
      /* layer without that paint property — skip */
    }
  }
}
