/**
 * configuracion.js
 * Configuración real, conectada a Supabase.
 * - Cerrar sesión: real (supabase.auth.signOut()).
 * - Cambiar contraseña: real (supabase.auth.updateUser({ password })).
 * - Exportar datos: real, descarga un JSON con tus proyectos y
 *   registros, leídos directamente de Supabase.
 * - Preferencias (notificaciones): se guardan en user_metadata.
 * - Membrete de documentos: logo y datos de la empresa para los PDF y
 *   Word. El logo se sube al bucket "avatars" (el mismo de la foto de
 *   perfil), en la carpeta de la persona; los datos van en
 *   user_metadata.membrete.
 *
 * Cambios de la versión de rediseño:
 *  - CORRECCIÓN: al cerrar sesión (o sin sesión) se redirigía a
 *    "login.html" relativo a app/, es decir app/login.html, que no
 *    existe (error 404). Ahora va a la pantalla de acceso de la raíz.
 *  - La contraseña nueva exige mínimo 8 caracteres, igual que el
 *    registro (antes pedía 6), y los errores se muestran bajo el campo.
 *  - Se quitó el índice de secciones que se generaba arriba: con las
 *    secciones agrupadas en tarjetas, la página es corta.
 */

import { supabase } from './config/supabase.js';
import { announce } from './app-shell.js';
import { confirmDialog } from './utils/alertas.js';
import { setFieldError, clearFieldError } from './utils/validaciones.js';

// Pantalla de acceso (index.html de la raíz): js/configuracion.js → ../
const PANTALLA_ACCESO = new URL('../', import.meta.url).href;
const PASSWORD_MIN_LENGTH = 8;
const LOGO_BUCKET = 'avatars';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

let currentUser = null;

/* ============================================================================
   CARGA DE DATOS REALES DE LA CUENTA
   ============================================================================ */
async function loadAccountInfo() {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    announce('Debes iniciar sesión para ver la configuración.');
    window.location.href = PANTALLA_ACCESO;
    return;
  }

  currentUser = user;
  const meta = user.user_metadata || {};

  const nombreCorreoEl = document.getElementById('config-nombre-correo');
  if (nombreCorreoEl) {
    const nombre = meta.full_name || meta.nombre || 'Sin nombre registrado';
    nombreCorreoEl.textContent = `${nombre} · ${user.email}`;
  }

  const notifToggle = document.getElementById('config-notificaciones');
  if (notifToggle) {
    notifToggle.checked = meta.notificaciones_correo !== false;
  }

  renderEstadoMembrete();

  // Enlace directo desde Documentos: configuracion.html#membrete
  if (window.location.hash === '#membrete') {
    const btn = document.getElementById('btn-membrete');
    if (btn) {
      document.getElementById('membrete').scrollIntoView({ block: 'center' });
      openMembreteModal(btn);
    }
  }
}

/* ============================================================================
   MEMBRETE DE DOCUMENTOS
   ============================================================================ */
function getMembrete() {
  return (currentUser && currentUser.user_metadata && currentUser.user_metadata.membrete) || {};
}

function renderEstadoMembrete() {
  const m = getMembrete();
  const estado = document.getElementById('membrete-estado');
  const thumb = document.getElementById('membrete-thumb');
  const btn = document.getElementById('btn-membrete');
  const configurado = Boolean(m.empresa || m.logo_url);

  if (estado) {
    estado.textContent = configurado
      ? [m.empresa || 'Sin nombre de empresa', m.logo_url ? 'con logo' : 'sin logo'].join(' · ')
      : 'Logo y datos de tu empresa en los PDF y Word';
  }
  if (btn) btn.textContent = configurado ? 'Editar' : 'Configurar';
  if (thumb) {
    thumb.innerHTML = '';
    if (m.logo_url) {
      const img = document.createElement('img');
      img.src = m.logo_url;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.dataset.icon = 'documento';
      thumb.appendChild(icon);
    }
  }
}

function campoTexto({ id, label, value = '', type = 'text', autocomplete = '', placeholder = '', inputMode = '' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.value = value || '';
  if (autocomplete) input.autocomplete = autocomplete;
  if (placeholder) input.placeholder = placeholder;
  if (inputMode) input.inputMode = inputMode;
  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function openMembreteModal(trigger) {
  if (!currentUser || document.getElementById('membrete-titulo')) {
    return;
  }

  const actual = getMembrete();
  let archivoNuevo = null;
  let objectUrl = null;
  let quitarLogo = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'membrete-titulo');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = 'Cerrar';

  const title = document.createElement('h2');
  title.id = 'membrete-titulo';
  title.className = 'modal-title';
  title.textContent = 'Membrete de documentos';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = 'Aparece en el encabezado de cada página de tus PDF y Word.';

  const form = document.createElement('form');
  form.noValidate = true;

  // --- Logo ---
  const logoField = document.createElement('div');
  logoField.className = 'membrete-logo-field';
  const logoBox = document.createElement('div');
  logoBox.className = 'membrete-logo-box';
  const logoActions = document.createElement('div');
  logoActions.className = 'membrete-logo-actions';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = LOGO_TIPOS.join(',');
  fileInput.className = 'visually-hidden';
  fileInput.id = 'membrete-logo-input';
  fileInput.setAttribute('aria-label', 'Elegir logo de la empresa');

  const elegirBtn = document.createElement('button');
  elegirBtn.type = 'button';
  elegirBtn.className = 'pill-btn';
  elegirBtn.textContent = 'Elegir logo';

  const hint = document.createElement('p');
  hint.className = 'membrete-logo-hint';
  hint.textContent = 'PNG o JPG, máximo 2 MB. Mejor con fondo blanco o transparente.';

  const quitarBtn = document.createElement('button');
  quitarBtn.type = 'button';
  quitarBtn.className = 'membrete-quitar';
  quitarBtn.textContent = 'Quitar logo';

  logoActions.appendChild(elegirBtn);
  logoActions.appendChild(hint);
  logoActions.appendChild(quitarBtn);
  logoActions.appendChild(fileInput);
  logoField.appendChild(logoBox);
  logoField.appendChild(logoActions);
  form.appendChild(logoField);

  // --- Datos de la empresa ---
  const empresa = campoTexto({ id: 'membrete-empresa', label: 'Nombre de la empresa', value: actual.empresa, autocomplete: 'organization', placeholder: 'Ej. Constructora del Caribe S.A.S.' });
  const nit = campoTexto({ id: 'membrete-nit', label: 'NIT (opcional)', value: actual.nit, placeholder: 'Ej. 900.123.456-7' });
  const direccion = campoTexto({ id: 'membrete-direccion', label: 'Dirección (opcional)', value: actual.direccion, autocomplete: 'street-address' });
  const telefono = campoTexto({ id: 'membrete-telefono', label: 'Teléfono (opcional)', value: actual.telefono, autocomplete: 'tel', inputMode: 'tel' });
  const correo = campoTexto({ id: 'membrete-correo', label: 'Correo (opcional)', value: actual.correo, type: 'email', autocomplete: 'email' });
  form.appendChild(empresa.wrapper);
  form.appendChild(nit.wrapper);
  form.appendChild(direccion.wrapper);
  const filaContacto = document.createElement('div');
  filaContacto.className = 'form-row';
  filaContacto.appendChild(telefono.wrapper);
  filaContacto.appendChild(correo.wrapper);
  form.appendChild(filaContacto);

  // --- Vista previa del encabezado ---
  const preview = document.createElement('div');
  preview.className = 'membrete-preview';
  form.appendChild(preview);

  // --- Acciones ---
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Guardar membrete';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancelar';
  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  dialog.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(form);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function logoActualUrl() {
    if (archivoNuevo) return objectUrl;
    if (quitarLogo) return '';
    return actual.logo_url || '';
  }

  function render() {
    const url = logoActualUrl();
    logoBox.innerHTML = '';
    logoBox.classList.toggle('has-logo', Boolean(url));
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Logo de la empresa';
      logoBox.appendChild(img);
    } else {
      logoBox.textContent = 'Sin logo';
    }
    elegirBtn.textContent = url ? 'Cambiar logo' : 'Elegir logo';
    quitarBtn.hidden = !url;

    preview.innerHTML = '';
    const label = document.createElement('p');
    label.className = 'membrete-preview-label';
    label.textContent = 'Así se verá en tus documentos';
    const banda = document.createElement('div');
    banda.className = 'membrete-preview-banda';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      banda.appendChild(img);
    }
    const datos = document.createElement('div');
    datos.className = 'membrete-preview-datos';
    const nombre = document.createElement('strong');
    nombre.textContent = empresa.input.value.trim() || 'Nombre de la empresa';
    datos.appendChild(nombre);
    if (nit.input.value.trim()) {
      const n = document.createElement('span');
      n.textContent = `NIT ${nit.input.value.trim()}`;
      datos.appendChild(n);
    }
    const contacto = [direccion.input.value, telefono.input.value, correo.input.value].map((v) => v.trim()).filter(Boolean).join(' · ');
    if (contacto) {
      const c = document.createElement('span');
      c.textContent = contacto;
      datos.appendChild(c);
    }
    banda.appendChild(datos);
    preview.appendChild(label);
    preview.appendChild(banda);
  }

  function close() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    if (window.location.hash === '#membrete') {
      history.replaceState(null, '', window.location.pathname);
    }
    if (trigger) trigger.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  elegirBtn.addEventListener('click', () => fileInput.click());
  quitarBtn.addEventListener('click', () => {
    archivoNuevo = null;
    quitarLogo = true;
    fileInput.value = '';
    render();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!LOGO_TIPOS.includes(file.type)) {
      announce('El logo debe ser una imagen PNG, JPG o WEBP.');
      fileInput.value = '';
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      announce('El logo pesa más de 2 MB. Usa una imagen más liviana.');
      fileInput.value = '';
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    archivoNuevo = file;
    objectUrl = URL.createObjectURL(file);
    quitarLogo = false;
    render();
  });
  [empresa, nit, direccion, telefono, correo].forEach(({ input }) => {
    input.addEventListener('input', () => {
      clearFieldError(input);
      render();
    });
  });

  document.addEventListener('keydown', onKeydown);
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldError(empresa.input);
    if (!empresa.input.value.trim()) {
      setFieldError(empresa.input, 'Escribe el nombre de la empresa.');
      empresa.input.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando…';

    try {
      let logoUrl = quitarLogo ? '' : (actual.logo_url || '');

      if (archivoNuevo) {
        const extension = archivoNuevo.type === 'image/png' ? 'png' : (archivoNuevo.type === 'image/webp' ? 'webp' : 'jpg');
        const ruta = `${currentUser.id}/logo-empresa.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(LOGO_BUCKET)
          .upload(ruta, archivoNuevo, { upsert: true, contentType: archivoNuevo.type });
        if (uploadError) {
          console.error('Error al subir el logo:', uploadError);
          announce('No se pudo subir el logo. Intenta de nuevo.');
          return;
        }
        const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(ruta);
        // ?v= evita que el navegador muestre el logo anterior guardado en caché
        logoUrl = data ? `${data.publicUrl}?v=${Date.now()}` : '';
      }

      const membrete = {
        empresa: empresa.input.value.trim(),
        nit: nit.input.value.trim(),
        direccion: direccion.input.value.trim(),
        telefono: telefono.input.value.trim(),
        correo: correo.input.value.trim(),
        logo_url: logoUrl,
      };

      const { data, error } = await supabase.auth.updateUser({
        data: { ...currentUser.user_metadata, membrete },
      });
      if (error) {
        console.error('Error al guardar el membrete:', error);
        announce('No se pudo guardar el membrete. Intenta de nuevo.');
        return;
      }

      currentUser = (data && data.user) || {
        ...currentUser,
        user_metadata: { ...currentUser.user_metadata, membrete },
      };
      renderEstadoMembrete();
      close();
      announce('Membrete guardado. Tus próximos documentos saldrán con él.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar membrete';
    }
  });

  render();
  empresa.input.focus();
}

/* ============================================================================
   PREFERENCIAS (se guardan en user_metadata)
   ============================================================================ */
function initPreferences() {
  const notifToggle = document.getElementById('config-notificaciones');
  if (notifToggle) {
    notifToggle.addEventListener('change', async () => {
      if (!currentUser) {
        return;
      }
      const valor = notifToggle.checked;
      notifToggle.disabled = true;

      const { error } = await supabase.auth.updateUser({
        data: { ...currentUser.user_metadata, notificaciones_correo: valor },
      });

      notifToggle.disabled = false;

      if (error) {
        console.error('Error al guardar la preferencia:', error);
        notifToggle.checked = !valor; // vuelve al estado anterior
        announce('No se pudo guardar la preferencia. Intenta de nuevo.');
        return;
      }
      currentUser.user_metadata = { ...currentUser.user_metadata, notificaciones_correo: valor };
      announce(valor ? 'Notificaciones por correo activadas.' : 'Notificaciones por correo desactivadas.');
    });
  }

  const idiomaSelect = document.getElementById('config-idioma');
  if (idiomaSelect) {
    idiomaSelect.addEventListener('change', () => {
      announce('Por ahora la plataforma solo está disponible en español.');
    });
  }
}

/* ============================================================================
   EXPORTAR DATOS REALES
   ============================================================================ */
async function exportUserData() {
  const button = document.getElementById('btn-exportar-datos');
  if (!currentUser) {
    return;
  }
  button.disabled = true;
  button.textContent = 'Preparando…';

  try {
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .is('deleted_at', null);

    if (projectsError) {
      throw projectsError;
    }

    const projectIds = (projects || []).map((p) => p.id);
    let entries = [];

    if (projectIds.length) {
      const { data: entriesData, error: entriesError } = await supabase
        .from('bitacora_entries')
        .select('*')
        .in('project_id', projectIds)
        .is('deleted_at', null);

      if (entriesError) {
        throw entriesError;
      }
      entries = entriesData || [];
    }

    const payload = {
      exportado_el: new Date().toISOString(),
      usuario: currentUser.email,
      proyectos: projects || [],
      registros_bitacora: entries,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bcivil-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    announce('Tus datos se descargaron.');
  } catch (error) {
    console.error('Error al exportar los datos:', error);
    announce('No se pudieron exportar tus datos. Intenta de nuevo.');
  } finally {
    button.disabled = false;
    button.textContent = 'Exportar';
  }
}

/* ============================================================================
   CAMBIAR CONTRASEÑA (real)
   ============================================================================ */
function buildPasswordField(id, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.autocomplete = 'new-password';
  input.required = true;
  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function openChangePasswordModal(trigger) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'cambiar-password-titulo');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = 'Cerrar';

  const title = document.createElement('h2');
  title.id = 'cambiar-password-titulo';
  title.className = 'modal-title';
  title.textContent = 'Cambiar contraseña';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`;

  const form = document.createElement('form');
  form.noValidate = true;

  const nueva = buildPasswordField('nueva-password', 'Nueva contraseña');
  const confirmar = buildPasswordField('confirmar-password', 'Confirmar nueva contraseña');

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Guardar nueva contraseña';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancelar';

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(nueva.wrapper);
  form.appendChild(confirmar.wrapper);
  form.appendChild(actions);

  dialog.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(form);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  nueva.input.focus();

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    if (trigger) {
      trigger.focus();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  document.addEventListener('keydown', onKeydown);
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  [nueva.input, confirmar.input].forEach((input) => {
    input.addEventListener('input', () => clearFieldError(input));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldError(nueva.input);
    clearFieldError(confirmar.input);

    if (nueva.input.value.length < PASSWORD_MIN_LENGTH) {
      setFieldError(nueva.input, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      nueva.input.focus();
      return;
    }
    if (nueva.input.value !== confirmar.input.value) {
      setFieldError(confirmar.input, 'Las contraseñas no coinciden.');
      confirmar.input.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando…';

    const { error } = await supabase.auth.updateUser({ password: nueva.input.value });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar nueva contraseña';

    if (error) {
      console.error('Error al cambiar la contraseña:', error);
      announce('No se pudo cambiar la contraseña. Intenta de nuevo.');
      return;
    }

    close();
    announce('Tu contraseña fue actualizada.');
  });
}

/* ============================================================================
   CERRAR SESIÓN (real)
   ============================================================================ */
async function handleSignOut(trigger) {
  const confirmed = await confirmDialog({
    titleText: 'Cerrar sesión',
    message: '¿Seguro que quieres cerrar tu sesión en este dispositivo?',
    confirmLabel: 'Cerrar sesión',
    confirmClassName: 'btn btn-secondary settings-danger-btn',
    restoreFocusTo: trigger,
  });

  if (!confirmed) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Error al cerrar sesión:', error);
    announce('No se pudo cerrar la sesión. Intenta de nuevo.');
    return;
  }

  window.location.replace(PANTALLA_ACCESO);
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
function init() {
  initPreferences();

  const exportBtn = document.getElementById('btn-exportar-datos');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportUserData);
  }

  const passwordBtn = document.getElementById('btn-cambiar-password');
  if (passwordBtn) {
    passwordBtn.addEventListener('click', () => openChangePasswordModal(passwordBtn));
  }

  const membreteBtn = document.getElementById('btn-membrete');
  if (membreteBtn) {
    membreteBtn.addEventListener('click', () => openMembreteModal(membreteBtn));
  }

  const signOutBtn = document.getElementById('btn-cerrar-sesion');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => handleSignOut(signOutBtn));
  }

  loadAccountInfo();
}

document.addEventListener('DOMContentLoaded', init);