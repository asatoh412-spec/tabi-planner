// 以前のPWA版が端末に残した Service Worker を消すための「片付け役」。
// 古い版はこの sw.js を登録していたので、ブラウザが更新を確認したときにこれが入り、
// キャッシュを全部消して自分自身の登録を解除し、開いているページを読み込み直す。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach(c => c.navigate(c.url))
  })())
})
