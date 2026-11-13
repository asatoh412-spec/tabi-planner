/** 新しい版の確認と、データ（キー・旅行）を消さずに古い版の残りだけを片付ける更新 */
export const BUILD = __BUILD__

export async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? ((await r.json()).build as string) : null
  } catch { return null }
}

/** Service Worker と保存されたページ（Cache Storage）だけを消して読み込み直す。IndexedDB（キー・旅行）と localStorage は消さない */
export async function hardUpdate() {
  try { for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister() } catch { /* なし */ }
  try { for (const k of await caches.keys()) await caches.delete(k) } catch { /* なし */ }
  location.replace(`${location.pathname}?v=${Date.now()}`)
}
