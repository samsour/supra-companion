import type mapboxgl from 'mapbox-gl'

const hasCustomStyle = Boolean(import.meta.env.VITE_MAPBOX_STYLE)

// NFS-minimap width curves: drivable streets read as bold bright ribbons,
// majors much fatter than the stock style at every zoom
type WidthExpression = mapboxgl.ExpressionSpecification
const zoomWidth = (stops: [number, number][]): WidthExpression =>
  ['interpolate', ['exponential', 1.4], ['zoom'], ...stops.flat()] as unknown as WidthExpression
const WIDTH_MAJOR = zoomWidth([[5, 1.5], [10, 4], [14, 12], [16, 22], [18, 44]])
const WIDTH_MID = zoomWidth([[5, 1], [10, 2.5], [14, 8], [16, 14], [18, 30]])
const WIDTH_MINOR = zoomWidth([[10, 0.5], [14, 4], [16, 8], [18, 18]])

/**
 * NFS-minimap look, applied at runtime over stock dark-v11: near-black
 * ground, muted slate buildings, streets as bright high-contrast ribbons
 * (white majors, light-grey minors), POI clutter hidden. Skipped when a
 * hand-built Studio style is configured via VITE_MAPBOX_STYLE.
 */
export function applyNeonStyle(map: mapboxgl.Map): void {
  if (hasCustomStyle) return
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    const { id, type } = layer
    try {
      if (type === 'background') {
        map.setPaintProperty(id, 'background-color', '#0a0d12')
      } else if (type === 'fill' && /water/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#2f86d1')
      } else if (type === 'fill' && /building/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#333f4c')
      } else if (type === 'fill' && /land|landuse|landcover|national-park|pitch|sand/.test(id)) {
        map.setPaintProperty(id, 'fill-color', '#10151c')
      } else if (type === 'line' && /case|casing/.test(id)) {
        // casings become thin dark seams so parallel roads stay separable
        map.setPaintProperty(id, 'line-color', '#0a0d12')
      } else if (type === 'line' && /motorway|trunk/.test(id)) {
        map.setPaintProperty(id, 'line-color', '#ffffff')
        map.setPaintProperty(id, 'line-width', WIDTH_MAJOR)
      } else if (type === 'line' && /primary|secondary|major/.test(id)) {
        map.setPaintProperty(id, 'line-color', '#e6ebf1')
        map.setPaintProperty(id, 'line-width', WIDTH_MID)
      } else if (
        type === 'line' &&
        /road|street|minor|tertiary|tunnel|bridge|link|pedestrian|path/.test(id)
      ) {
        map.setPaintProperty(id, 'line-color', '#aab5c2')
        map.setPaintProperty(id, 'line-width', WIDTH_MINOR)
      } else if (type === 'symbol' && /poi|transit|airport|natural|water-point|golf/.test(id)) {
        map.setLayoutProperty(id, 'visibility', 'none') // minimap: no POI clutter
      } else if (type === 'symbol') {
        map.setPaintProperty(id, 'text-color', '#7d8896')
        map.setPaintProperty(id, 'text-halo-color', '#0a0d12')
      }
    } catch {
      /* layer without that property — skip */
    }
  }
}
