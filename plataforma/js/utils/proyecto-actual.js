/**
 * proyecto-actual.js
 * Fuente única de verdad para "cuál es el proyecto activo", utilizable
 * desde cualquier página de la app, no solo desde la bitácora.
 *
 * Prioridad: primero el parámetro ?project_id= de la URL actual (si la
 * página lo trae, como bitacora.html o proyecto.html); si no existe,
 * cae al último proyecto guardado en localStorage (por ejemplo, el que
 * el dashboard determinó como "más reciente" al iniciar sesión).
 */

const STORAGE_KEY = 'bcivil_current_project_id';

export function getCurrentProjectId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('project_id');

  if (fromUrl) {
    setCurrentProjectId(fromUrl);
    return fromUrl;
  }

  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

export function setCurrentProjectId(projectId) {
  if (!projectId) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, projectId);
  } catch (error) {
    // Almacenamiento no disponible (modo privado, etc.): se ignora,
    // la app sigue funcionando solo con el parámetro de la URL.
  }
}
