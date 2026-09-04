/** Profilbild: klein skaliert als Data-URL — lokal gespeichert und einmalig
 *  per Presence an den Konvoi verteilt (nie in den Positions-Pings). */

export async function fileToAvatar(file: File, size = 96): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'))
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas nicht verfügbar')
    const s = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    if (dataUrl.length > 40_000) throw new Error('Bild zu groß — bitte ein anderes wählen')
    return dataUrl
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const isAvatar = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('data:image/') && v.length < 40_000
