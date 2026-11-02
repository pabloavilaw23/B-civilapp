/**
 * Service Worker de B-Civil.
 *
 * Dos trabajos:
 * 1) Guardar en caché el armazón de TODA la app (HTML/CSS/JS de cada
 *    sección) para que abra aunque no haya señal.
 * 2) Dejar pasar SIEMPRE las llamadas a Supabase (datos, fotos, audio)
 *    directo a la red — esas nunca se cachean aquí, porque el manejo
 *    de "sin conexión" para los datos vive en el propio código de la
 *    app (offline-queue.js y el respaldo local de timeline.js), no en
 *    el service worker.
 *
 * IMPORTANTE — bug ya corregido: no se cachea la ruta "/" directamente,
 * porque en Cloudflare Pages "/" responde con una redirección hacia
 * "/index.html". Safari se niega a servir desde caché cualquier
 * respuesta que haya venido de una redirección ("Response served by
 * service worker has redirections"). Por eso aquí siempre se guarda
 * una copia "limpia" de cada respuesta (sin el historial de
 * redirección), tanto al instalar como en cada visita.
 *
 * v6 — index.html pasa a ser la pantalla de acceso (se eliminó la
 * landing). Se quitó landing.css del armazón y se añadieron los
 * scripts e iconos que necesita la pantalla de acceso. Al cambiar el
 * nombre de la caché, "activate" borra la v5 con la landing antigua.
 *
 * 2026-10-08 — Etapa 4 (registros anexados y edición) + menú ⋯ en Proyectos y Cerrar sesión en Perfil. Se añadieron al
 * armazón la bienvenida y los módulos de las etapas 1 a 4. El nombre usa
 * la fecha para que sea distinto a cualquier versión anterior.
 */

const CACHE_NAME = 'bcivil-shell-2026-10-08-etapa4b';

const APP_SHELL = [
  // Acceso
  '/index.html',
  '/login.html',
  '/registro.html',
  '/manifest.json',
  '/img/icons/icon-192.png',
  '/js/app.js',
  '/js/auth-header-elevation.js',
  '/js/auth/login.js',
  '/js/auth/registro.js',
  '/js/auth/recuperar-password.js',
  '/js/auth/redirigir-si-sesion.js',
  '/js/auth/sesion.js',
  '/js/config/supabase.js',
  '/js/utils/validaciones.js',

  // Estilos
  '/css/main.css',
  '/css/bienvenida.css',
  '/css/components.css',
  '/css/responsive.css',
  '/css/icons.css',
  '/css/auth.css',
  '/css/app-shell.css',
  '/css/dashboard.css',
  '/css/bitacora.css',
  '/css/proyectos.css',
  '/css/documentos.css',
  '/css/asistente.css',
  '/css/perfil.css',
  '/css/configuracion.css',
  '/css/papelera.css',

  // App privada
  '/app/dashboard.html',
  '/app/bitacora/bitacora.html',
  '/app/proyectos/index.html',
  '/app/proyectos/proyecto.html',
  '/app/documentos/documentos.html',
  '/app/chat/asistente.html',
  '/app/perfil.html',
  '/app/configuracion.html',
  '/app/papelera/papelera.html',
  '/js/app-shell.js',
  '/js/dashboard.js',
  '/js/registro-global.js',
  '/js/hub-account-menu.js',
  '/js/sw-register.js',
  '/js/bitacora/timeline.js',
  '/js/bitacora/multimedia.js',
  '/js/utils/offline-queue.js',
  '/js/utils/proyecto-actual.js',
  '/js/utils/personal.js',
  '/js/utils/alertas.js',
  '/js/utils/fechas.js',
  '/js/utils/formato.js',
  '/js/bitacora/almacenamiento.js',
  '/js/bitacora/exportar-bitacora.js',
  '/js/proyectos/proyectos.js',
  '/js/proyectos/proyecto.js',
  '/js/proyectos/personal.js',
];

/**
 * Pide una URL a la red y devuelve una respuesta "limpia": misma
 * información, pero reconstruida desde cero, sin el historial de
 * redirección que Safari rechaza al servir desde caché.
 */
async function fetchClean(url) {
  const response = await fetch(url);
  if (!response || !response.ok) {
    return null;
  }
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Se guarda archivo por archivo (no con addAll) para que, si
      // alguna ruta no existe todavía o cambió de nombre, el resto
      // del armazón igual quede cacheado en vez de fallar por completo.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            const clean = await fetchClean(url);
            if (clean) {
              await cache.put(url, clean);
            }
          } catch (error) {
            console.warn('[sw] no se pudo cachear:', url);
          }
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo intervenimos en peticiones GET del propio sitio (HTML, CSS,
  // JS, imágenes propias). Todo lo demás — y en particular cualquier
  // llamada a Supabase — pasa directo a la red, sin tocarla.
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  const esNavegacionHTML = request.mode === 'navigate'
    || (request.headers.get('accept') || '').includes('text/html');

  if (esNavegacionHTML) {
    // Páginas (HTML): "network-first". Siempre se intenta traer la
    // versión más reciente de internet primero — solo se usa la
    // copia guardada si de verdad no hay señal.
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.ok) {
            const body = await response.clone().blob();
            const clean = new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, clean);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            return cached;
          }
          // Sin señal y abriendo la raíz ("/"), que no se guarda como
          // tal: se sirve la copia de /index.html (pantalla de acceso).
          const url = new URL(request.url);
          if (url.pathname === '/') {
            return caches.match('/index.html');
          }
          return undefined;
        }),
    );
    return;
  }

  // Todo lo demás (CSS, JS, imágenes): "stale-while-revalidate". Se
  // muestra la copia guardada de inmediato si existe (más rápido), y
  // se actualiza en segundo plano para la próxima vez.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then(async (response) => {
          if (response && response.ok) {
            const body = await response.clone().blob();
            const clean = new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clean));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    }),
  );
});