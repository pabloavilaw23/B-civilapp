/**
 * redirigir-si-sesion.js
 * Ahora que index.html es la pantalla de acceso (y el inicio de la PWA),
 * quien ya tiene una sesión guardada no debe volver a escribir su clave
 * cada vez que abre la app: se le lleva directo al dashboard.
 *
 * getSession() lee la sesión guardada en el dispositivo, así que
 * funciona también sin conexión. Si no hay sesión, no hace nada y la
 * pantalla de acceso sigue normalmente.
 *
 * No modifica ni depende de login.js.
 */

import { supabase } from '../config/supabase.js';

const DASHBOARD = new URL('../../app/dashboard.html', import.meta.url).href;

async function redirigirSiHaySesion() {
  try {
    const { data } = await supabase.auth.getSession();

    if (data && data.session) {
      window.location.replace(DASHBOARD);
    }
  } catch (error) {
    // Ante cualquier fallo se queda en la pantalla de acceso.
    console.warn('[acceso] no se pudo comprobar la sesión:', error);
  }
}

redirigirSiHaySesion();
