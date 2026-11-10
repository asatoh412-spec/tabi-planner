import { openDB, type DBSchema } from 'idb'
import type { MapArea, Preset, Settings, Trip } from './types'

interface TabiDB extends DBSchema {
  settings: { key: string; value: Settings }
  trips: { key: string; value: Trip }
  presets: { key: string; value: Preset }
  areas: { key: string; value: MapArea }
}

const dbp = openDB<TabiDB>('tabi', 1, {
  upgrade(db) {
    db.createObjectStore('settings')
    db.createObjectStore('trips', { keyPath: 'id' })
    db.createObjectStore('presets', { keyPath: 'id' })
    db.createObjectStore('areas', { keyPath: 'id' })
  },
})

export const defaultSettings: Settings = {
  googleKey: '', anthropicKey: '', rakutenAppId: '', rakutenAccessKey: '',
  claudeModel: 'claude-sonnet-5-5', maxRepair: 3,
}

export async function getSettings(): Promise<Settings> {
  const s = await (await dbp).get('settings', 'main')
  return { ...defaultSettings, ...s }
}
export async function saveSettings(s: Settings) { await (await dbp).put('settings', s, 'main') }

export async function listAreas() { return (await dbp).getAll('areas') }
export async function saveArea(a: MapArea) { await (await dbp).put('areas', a) }
export async function deleteArea(id: string) { await (await dbp).delete('areas', id) }

export async function listTrips() { return (await dbp).getAll('trips') }
export async function saveTrip(t: Trip) { await (await dbp).put('trips', t) }
export async function getTrip(id: string) { return (await dbp).get('trips', id) }
export async function deleteTrip(id: string) { await (await dbp).delete('trips', id) }
export async function getArea(id: string) { return (await dbp).get('areas', id) }

export async function listPresets() { return (await dbp).getAll('presets') }
export async function savePreset(p: Preset) { await (await dbp).put('presets', p) }
export async function deletePreset(id: string) { await (await dbp).delete('presets', id) }

/** Placesの座標は取得から30日で消す（Google規約） */
export async function purgeExpiredGoogleCoords() {
  const limit = Date.now() - 30 * 864e5
  const db = await dbp
  for (const t of await db.getAll('trips')) {
    let changed = false
    for (const p of t.plans) for (const d of p.days) for (const s of d.stops) {
      if (s.googleCoord && Date.parse(s.googleCoord.fetchedAt) < limit) { delete s.googleCoord; changed = true }
    }
    if (changed) await db.put('trips', t)
  }
}

export const newId = () => crypto.randomUUID()
