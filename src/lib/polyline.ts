/** Google の encoded polyline を緯度経度の配列に戻す */
export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < s.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b: number
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const v = result & 1 ? ~(result >> 1) : result >> 1
      if (k === 0) lat += v; else lng += v
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}
