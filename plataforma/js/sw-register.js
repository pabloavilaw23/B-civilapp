/**
 * Registra el Service Worker. Este archivo se importa igual desde
 * cualquier página (raíz o dentro de app/), porque la ruta al propio
 * sw.js siempre se calcula desde la raíz del sitio ("/sw.js"),
 * sin importar en qué carpeta esté la página que lo llama.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}
