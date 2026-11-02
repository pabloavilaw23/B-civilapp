/**
 * offline-queue.js
 *
 * Guarda registros (texto, fotografía, nota de voz) en el propio
 * celular cuando no hay conexión, para subirlos solos apenas vuelva
 * la señal. Usa IndexedDB en vez de localStorage porque las fotos y
 * el audio son archivos binarios (Blob), y localStorage solo puede
 * guardar texto.
 *
 * Este archivo NO sabe nada de Supabase ni de bitácora — solo
 * almacena y entrega registros pendientes. Quien decide CÓMO subir
 * cada tipo de registro es registro-global.js, que ya tiene esa
 * lógica para cuando sí hay conexión.
 */

const DB_NAME = 'bcivil-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-entries';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Agrega un registro pendiente a la cola.
 * `record` debe traer: { tipo, projectId, ownerId, ...datos propios
 * del tipo (content, files, blob, etc.) }
 * Devuelve el id asignado.
 */
export async function queueEntry(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add({ ...record, queuedAt: Date.now() });

    request.onsuccess = () => {
      notifyQueueChanged();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingEntries() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingEntry(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      notifyQueueChanged();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function countPendingEntries() {
  const entries = await getPendingEntries();
  return entries.length;
}

/**
 * Avisa a cualquier parte de la app que la cola cambió (se agregó,
 * se subió o se quitó un registro), para que un indicador visual
 * (como el contador de pendientes) se actualice solo.
 */
export function notifyQueueChanged() {
  document.dispatchEvent(new CustomEvent('bcivil:queue-changed'));
}

export function isOnline() {
  return navigator.onLine;
}
