/**
 * formato.js
 * Utilidades de formato compartidas. Por ahora contiene únicamente la
 * normalización de texto usada para búsquedas insensibles a mayúsculas
 * y tildes, que se repetía (de forma inconsistente) en la bitácora y
 * en el listado de proyectos.
 */

/**
 * Normaliza un texto a minúsculas y sin tildes, para comparaciones de
 * búsqueda insensibles a mayúsculas y acentos.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Indica si "haystack" contiene "needle", ignorando mayúsculas y
 * tildes. Una consulta vacía siempre coincide.
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
export function textIncludes(haystack, needle) {
  const query = normalizeText(needle).trim();
  if (!query) {
    return true;
  }
  return normalizeText(haystack).includes(query);
}
