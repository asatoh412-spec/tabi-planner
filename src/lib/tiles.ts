import type { MapArea } from '../types'

export const GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
export const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">出典：国土地理院</a>'
export const TILE_CACHE = 'gsi-tiles'

const lon2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z)
const lat2y = (lat: number, z: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z) }

export function tileUrls(a: MapArea): string[] {
  const dLat = a.radiusKm / 111, dLng = a.radiusKm / (111 * Math.cos((a.center.lat * Math.PI) / 180))
  const out: string[] = []
  for (let z = a.minZoom; z <= a.maxZoom; z++) {
    const x0 = lon2x(a.center.lng - dLng, z), x1 = lon2x(a.center.lng + dLng, z)
    const y0 = lat2y(a.center.lat + dLat, z), y1 = lat2y(a.center.lat - dLat, z)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(GSI_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
  }
  return out
}

/** 指定範囲の地図画像を端末に保存する。サーバー負荷を考え、同時4件・合間に待ちを入れる */
export async function saveTiles(a: MapArea, onProgress: (done: number, total: number) => void, signal?: { stop: boolean }) {
  const urls = tileUrls(a)
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  const queue = [...urls]
  const worker = async () => {
    while (queue.length && !signal?.stop) {
      const u = queue.shift()!
      if (!(await cache.match(u))) {
        try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r) } catch { /* 取れなかった画像は飛ばす */ }
        await new Promise(res => setTimeout(res, 50))
      }
      onProgress(++done, urls.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return { done, total: urls.length }
}

export async function cachedTileCount() {
  try { return (await (await caches.open(TILE_CACHE)).keys()).length } catch { return 0 }
}
