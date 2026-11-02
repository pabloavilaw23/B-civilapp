/**
 * perfil.js
 * Perfil real, conectado a Supabase Auth. El nombre, cargo y empresa
 * se guardan en los metadatos del propio usuario (user_metadata). El
 * correo se muestra pero no se puede editar aquí todavía, porque
 * cambiarlo requiere un paso de verificación por correo.
 *
 * Cambios de la versión de rediseño:
 *  - CORRECCIÓN: sin sesión, redirigía a "login.html" relativo a
 *    app/, es decir app/login.html, que no existe (error 404). Ahora
 *    va a la pantalla de acceso de la raíz.
 *  - CORRECCIÓN: "Cancelar" no descartaba la foto elegida (la vista
 *    previa quedaba como si se hubiera guardado).
 *  - La foto se puede elegir tocando el botón de cámara sobre el
 *    avatar o el botón "Elegir fotografía" del formulario.
 */

import { supabase } from './config/supabase.js';
import { announce } from './app-shell.js';
import { confirmDialog } from './utils/alertas.js';

const AVATAR_BUCKET = 'avatars';

// Pantalla de acceso (index.html de la raíz): js/perfil.js → ../
const PANTALLA_ACCESO = new URL('../', import.meta.url).href;

let currentUser = null;
let objectUrl = null;

/* ============================================================================
   CARGA DE DATOS REALES
   ============================================================================ */
function getDisplayName(user) {
  const meta = user.user_metadata || {};
  return meta.full_name || meta.nombre || user.email;
}

function setDefaultPhoto() {
  const container = document.getElementById('profile-photo-container');
  if (!container) {
    return;
  }
  container.innerHTML = '';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.dataset.icon = 'usuario';
  icon.setAttribute('aria-hidden', 'true');
  container.appendChild(icon);
}

function setPhotoPreview(url) {
  const container = document.getElementById('profile-photo-container');
  if (!container) {
    return;
  }
  container.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Fotografía de perfil';
  container.appendChild(img);
}

function fillSummary(user) {
  const meta = user.user_metadata || {};

  const nameEl = document.getElementById('profile-summary-name');
  const roleEl = document.getElementById('profile-summary-role');
  const emailEl = document.getElementById('profile-summary-email');

  if (nameEl) nameEl.textContent = getDisplayName(user);
  if (roleEl) {
    roleEl.textContent = [meta.cargo, meta.empresa].filter(Boolean).join(' · ');
  }
  if (emailEl) emailEl.textContent = user.email || '';

  if (meta.avatar_url) {
    setPhotoPreview(meta.avatar_url);
  } else {
    setDefaultPhoto();
  }
}

function fillForm(user) {
  const meta = user.user_metadata || {};

  const nombreInput = document.getElementById('perfil-nombre');
  const cargoInput = document.getElementById('perfil-cargo');
  const empresaInput = document.getElementById('perfil-empresa');
  const correoInput = document.getElementById('perfil-correo');

  if (nombreInput) nombreInput.value = meta.full_name || meta.nombre || '';
  if (cargoInput) cargoInput.value = meta.cargo || '';
  if (empresaInput) empresaInput.value = meta.empresa || '';
  if (correoInput) correoInput.value = user.email || '';
}

function resetPhotoInput() {
  const input = document.getElementById('perfil-foto');
  const nameEl = document.getElementById('perfil-foto-nombre');
  if (input) {
    input.value = '';
  }
  if (nameEl) {
    nameEl.textContent = 'Ningún archivo seleccionado';
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

async function loadProfile() {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    announce('Debes iniciar sesión para ver tu perfil.');
    window.location.href = PANTALLA_ACCESO;
    return;
  }

  currentUser = user;
  fillSummary(user);
  fillForm(user);
}

/* ============================================================================
   FOTOGRAFÍA DE PERFIL
   ============================================================================ */
function initPhotoField() {
  const input = document.getElementById('perfil-foto');
  const nameEl = document.getElementById('perfil-foto-nombre');
  const triggers = [
    document.getElementById('perfil-foto-btn'),
    document.getElementById('perfil-foto-elegir'),
  ].filter(Boolean);

  if (!input) {
    return;
  }

  triggers.forEach((trigger) => trigger.addEventListener('click', () => input.click()));

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) {
      return;
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
    if (nameEl) {
      nameEl.textContent = `${file.name} (sin guardar)`;
    }
  });
}

/**
 * Sube la foto seleccionada al bucket "avatars" de Supabase Storage
 * y devuelve la URL pública. El bucket "avatars" debe existir y ser
 * público (Storage → New bucket → "avatars" → público).
 */
async function uploadAvatarIfNeeded() {
  const input = document.getElementById('perfil-foto');
  const file = input && input.files && input.files[0];
  if (!file) {
    return null;
  }

  const extension = file.name.split('.').pop() || 'jpg';
  const path = `${currentUser.id}/avatar.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    console.error('Error al subir la fotografía:', uploadError);
    announce('No se pudo subir la fotografía. Verifica que el almacenamiento esté configurado.');
    return null;
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  // Parámetro de versión: evita que el navegador muestre la foto anterior
  // guardada en caché (la ruta del archivo es siempre la misma).
  return data ? `${data.publicUrl}?v=${Date.now()}` : null;
}

/* ============================================================================
   GUARDAR CAMBIOS (UPDATE REAL EN SUPABASE AUTH)
   ============================================================================ */
async function handleSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    return;
  }

  const nombre = document.getElementById('perfil-nombre').value.trim();
  const cargo = document.getElementById('perfil-cargo').value.trim();
  const empresa = document.getElementById('perfil-empresa').value.trim();
  const submitBtn = document.getElementById('perfil-guardar');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  const avatarUrl = await uploadAvatarIfNeeded();

  const newMetadata = {
    ...currentUser.user_metadata,
    full_name: nombre,
    cargo,
    empresa,
  };
  if (avatarUrl) {
    newMetadata.avatar_url = avatarUrl;
  }

  const { data, error } = await supabase.auth.updateUser({ data: newMetadata });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Guardar cambios';

  if (error || !data || !data.user) {
    console.error('Error al actualizar el perfil:', error);
    announce('No se pudo guardar tu perfil. Intenta de nuevo.');
    return;
  }

  currentUser = data.user;
  resetPhotoInput();
  fillSummary(currentUser);
  announce('Perfil actualizado.');
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
function init() {
  initPhotoField();

  const form = document.getElementById('profile-form');
  const cancelBtn = document.getElementById('perfil-cancelar');

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      resetPhotoInput();
      if (currentUser) {
        fillForm(currentUser);
        fillSummary(currentUser);
      }
      announce('Cambios descartados.');
    });
  }

  loadProfile();
}

document.addEventListener('DOMContentLoaded', init);

/* ============================================================================
   CERRAR SESIÓN (también disponible en Configuración)
   ============================================================================ */
async function cerrarSesion(boton) {
  const confirmado = await confirmDialog({
    titleText: 'Cerrar sesión',
    message: '¿Seguro que quieres cerrar tu sesión en este dispositivo?',
    confirmLabel: 'Cerrar sesión',
    confirmClassName: 'btn btn-secondary settings-danger-btn',
    restoreFocusTo: boton,
  });
  if (!confirmado) {
    return;
  }

  boton.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Error al cerrar sesión:', error);
    announce('No se pudo cerrar la sesión. Intenta de nuevo.');
    boton.disabled = false;
    return;
  }
  window.location.replace(PANTALLA_ACCESO);
}

const botonCerrarSesion = document.getElementById('perfil-cerrar-sesion');
if (botonCerrarSesion) {
  botonCerrarSesion.addEventListener('click', () => cerrarSesion(botonCerrarSesion));
}