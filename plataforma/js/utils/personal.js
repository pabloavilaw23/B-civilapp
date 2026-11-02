/**
 * personal.js
 * Lectura del personal registrado en un proyecto (tabla "project_personnel").
 * La usan Proyecto (lista), el registro rápido (sugerencias de trabajador
 * en eventos SST) y Documentos (sugerencias en los documentos laborales).
 *
 * Nunca lanza errores: si la tabla todavía no existe (falta ejecutar el
 * script SQL de la Etapa 2) o no hay conexión, devuelve una lista vacía y
 * la app sigue funcionando.
 */

import { supabase } from '../config/supabase.js';

export async function cargarPersonal(projectId) {
  if (!projectId) {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('project_personnel')
      .select('*')
      .eq('project_id', projectId)
      .order('nombre', { ascending: true });

    if (error) {
      console.warn('No se pudo leer el personal del proyecto:', error.message || error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.warn('No se pudo leer el personal del proyecto:', error);
    return [];
  }
}
