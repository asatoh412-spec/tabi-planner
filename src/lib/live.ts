import { useEffect, useState } from 'react'
import { placeDetails, type Candidate } from '../api/clients'
import { getSettings } from '../db'

// Google由来の情報はここ（メモリ）にだけ置く。ページを閉じれば消える。
const cache = new Map<string, Candidate>()
const pending = new Map<string, Promise<Candidate | null>>()

export const remember = (c: Candidate) => cache.set(c.id, c)

/** 写真のURLを作るためのキー（設定から読む） */
let gkey = ''
getSettings().then(s => { gkey = s.googleKey }).catch(() => {})
export const googleKey = () => gkey
export const peek = (id: string) => cache.get(id)

export function fetchLive(id: string): Promise<Candidate | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!)
  if (!navigator.onLine) return Promise.resolve(null)
  if (!pending.has(id)) {
    pending.set(id, getSettings().then(s => s.googleKey ? placeDetails(s, id) : null).then(c => { if (c) cache.set(id, c); return c }).catch(() => null))
  }
  return pending.get(id)!
}

export function useLive(id: string | undefined): Candidate | null {
  const [c, setC] = useState<Candidate | null>(id ? cache.get(id) ?? null : null)
  useEffect(() => { if (id) fetchLive(id).then(setC) }, [id])
  return c
}
