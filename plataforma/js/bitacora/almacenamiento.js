/**
 * almacenamiento.js
 * Sube archivos (fotografías y notas de voz) al bucket privado
 * "bitacora-media" de Supabase Storage, organizados por
 * usuario/proyecto, y devuelve una URL firmada de larga duración para
 * guardar en bitacora_entries.
 */

import { supabase } from '../config/supabase.js';

const BUCKET = 'bitacora-media';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365 * 5; // 5 años

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/**
 * Sube un archivo o blob al bucket privado y devuelve una URL firmada.
 * @param {Blob|File} fileOrBlob
 * @param {string} fileName - nombre a usar (incluida la extensión)
 * @param {{ ownerId: string, projectId: string }} context
 * @returns {Promise<string>} URL firmada del archivo subido
 */
export async function uploadEntryFile(fileOrBlob, fileName, { ownerId, projectId }) {
  const path = `${ownerId}/${projectId}/${Date.now()}-${sanitizeFileName(fileName)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, fileOrBlob, {
      cacheControl: '3600',
      upsert: false,
      contentType: fileOrBlob.type || undefined,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedError || !data) {
    throw signedError || new Error('No se pudo generar el enlace del archivo.');
  }

  return data.signedUrl;
}
