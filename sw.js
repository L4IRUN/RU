// @ts-check

/**
 * @typedef {Event & { waitUntil: (promise: Promise<any>) => void }} ExtendableEvent
 * @typedef {Event & { request: Request, respondWith: (response: Promise<Response> | Response) => void }} FetchEvent
 * @typedef {{
 *   registration: ServiceWorkerRegistration,
 *   addEventListener: (
 *     ((type: 'install' | 'activate', listener: (event: ExtendableEvent) => void) => void) &
 *     ((type: 'fetch', listener: (event: FetchEvent) => void) => void) &
 *     ((type: string, listener: (event: any) => void) => void)
 *   )
 * }} ServiceWorkerGlobalScope
 */

const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const scope = new URL(worker.registration.scope);
const cachePrefix = `ru-static:${scope.pathname}:`;
// 每次發布靜態檔案都要更新這個版號，同一天也要遞增。
const cacheName = `${cachePrefix}20261120-7`;
const index = new URL('index.html', scope);
const assets = [
    'index.html',
    'manifest.webmanifest',
    'manifest-mobile.webmanifest',
    'icons/ru-desktop-192.png',
    'icons/ru-desktop-512.png',
    'icons/ru-192.png',
    'icons/ru-512.png',
    'icons/ru-clear-192.png',
    'icons/ru-clear-512.png',
    'style.css?v=82',
    'vendor/dexie-4.4.6.min.js',
    'main.js?v=81',
    'domain.js',
    'events.js',
    'interaction.js',
    'state.js',
    'storage.js',
    'sync.js',
    'ui.js',
    'modules/calendar.js',
    'modules/categoryMenu.js',
    'modules/categoryModal.js',
    'modules/dataTransfer.js',
    'modules/editor.js',
    'modules/editorInteractions.js',
    'modules/editorLayout.js',
    'modules/fullEditor.js',
    'modules/listInteractions.js',
    'modules/modalManager.js',
    'modules/navigation.js',
    'modules/navigationInteractions.js',
    'modules/paste.js',
    'modules/saveDelete.js',
    'modules/settings.js',
    'modules/sortModal.js',
    'modules/timeWheel.js',
    'modules/viewNavigation.js',
].map(path => new URL(path, scope).href);

worker.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        await cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })));
    })());
});

worker.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
            .map(key => caches.delete(key)));
    })());
});

worker.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isEntry = request.mode === 'navigate' && url.origin === scope.origin &&
        (url.pathname === scope.pathname || url.pathname === index.pathname);
    const assetUrl = isEntry ? index.href : request.url;
    if (!assets.includes(assetUrl)) return;

    event.respondWith((async () => {
        const cache = await caches.open(cacheName);
        return (await cache.match(assetUrl)) ?? fetch(request);
    })());
});
