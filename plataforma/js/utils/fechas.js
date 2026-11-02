/**
 * fechas.js
 * Formateo de fecha y hora para presentación visual, extraído de la
 * lógica que se repetía de forma idéntica en la bitácora y en el
 * generador de documentos.
 *
 * Solo incluye las funciones que la aplicación realmente usa.
 */

const DEFAULT_LOCALE = 'es-CO';

/**
 * Formatea una fecha como "12 de julio de 2026".
 * @param {Date} date
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDisplayDate(date, locale = DEFAULT_LOCALE) {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Formatea una hora como "10:42 a. m.".
 * @param {Date} date
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDisplayTime(date, locale = DEFAULT_LOCALE) {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Formatea fecha y hora combinadas como "12 de julio de 2026 · 10:42 a. m.".
 * @param {Date} date
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDisplayDateTime(date, locale = DEFAULT_LOCALE) {
  return `${formatDisplayDate(date, locale)} · ${formatDisplayTime(date, locale)}`;
}
