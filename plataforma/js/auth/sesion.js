import { supabase } from '../config/supabase.js';

/**
 * Pantalla de acceso (index.html en la raíz). Se calcula a partir de la
 * ubicación de este archivo (js/auth/sesion.js → ../../), así funciona
 * desde cualquier profundidad de carpeta (app/, app/proyectos/, etc.)
 * y tanto en Cloudflare Pages como en un servidor local.
 */
const PANTALLA_ACCESO = new URL('../../', import.meta.url).href;

/**
 * Devuelve el usuario autenticado.
 */
export async function getCurrentUser() {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    return user;
}

/**
 * Devuelve la sesión actual.
 */
export async function getCurrentSession() {
    const {
        data: { session },
    } = await supabase.auth.getSession();

    return session;
}

/**
 * Cierra la sesión y vuelve a la pantalla de acceso.
 */
export async function logout() {

    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error(error);
        return false;
    }

    window.location.replace(PANTALLA_ACCESO);

    return true;
}