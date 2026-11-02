/**
 * personal.js
 * Personal del proyecto (tabla "project_personnel"): lista, alta,
 * edición y baja desde la pantalla de un proyecto.
 *
 * Qué se guarda: nombre, cédula, cargo, EPS, ARL y teléfono. Los
 * documentos laborales (incapacidad, citación a descargos, reporte de
 * incidente) y el Asistente usan estos datos para completar solos la
 * cédula, el cargo y la EPS o ARL del trabajador.
 *
 * Son datos personales: solo los ve quien es dueño del proyecto (regla
 * de seguridad en la base de datos).
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { confirmDialog } from '../utils/alertas.js';
import { setFieldError, clearFieldError } from '../utils/validaciones.js';
import { cargarPersonal } from '../utils/personal.js';

const CARGOS = ['Obrero', 'Oficial de obra', 'Maestro de obra', 'Ayudante', 'Operador de maquinaria', 'Ing. residente', 'Inspector SST', 'Almacenista', 'Topógrafo'];

let projectId = null;
let personal = [];
let overlay = null;

function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function render() {
  const lista = document.getElementById('personal-lista');
  const vacio = document.getElementById('personal-vacio');
  const contador = document.getElementById('personal-count');
  if (!lista || !vacio) return;

  lista.innerHTML = '';
  personal.forEach((p) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'personal-item';
    btn.setAttribute('aria-label', `Editar a ${p.nombre}`);

    const avatar = document.createElement('span');
    avatar.className = 'personal-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = iniciales(p.nombre);

    const info = document.createElement('span');
    info.className = 'personal-info';
    const nombre = document.createElement('span');
    nombre.className = 'personal-nombre';
    nombre.textContent = p.nombre;
    info.appendChild(nombre);

    const linea1 = [p.cargo, p.cedula ? `C.C. ${p.cedula}` : ''].filter(Boolean).join(' · ');
    const linea2 = [p.eps ? `EPS ${p.eps}` : '', p.arl ? `ARL ${p.arl}` : ''].filter(Boolean).join(' · ');
    [linea1, linea2].forEach((texto) => {
      if (!texto) return;
      const meta = document.createElement('span');
      meta.className = 'personal-meta';
      meta.textContent = texto;
      info.appendChild(meta);
    });

    btn.appendChild(avatar);
    btn.appendChild(info);
    btn.addEventListener('click', () => abrirFormulario(p, btn));
    li.appendChild(btn);
    lista.appendChild(li);
  });

  lista.hidden = !personal.length;
  vacio.hidden = personal.length > 0;
  if (contador) contador.textContent = personal.length ? `(${personal.length})` : '';
}

async function recargar() {
  personal = await cargarPersonal(projectId);
  render();
}

function campo({ id, label, value = '', type = 'text', inputMode = '', list = '', autocomplete = 'off', required = false }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const l = document.createElement('label');
  l.setAttribute('for', id);
  l.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.value = value || '';
  input.autocomplete = autocomplete;
  if (inputMode) input.inputMode = inputMode;
  if (list) input.setAttribute('list', list);
  if (required) input.setAttribute('aria-required', 'true');
  input.addEventListener('input', () => clearFieldError(input));
  wrapper.appendChild(l);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function cerrar(trigger) {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  document.removeEventListener('keydown', alEscape);
  if (trigger && trigger.isConnected) trigger.focus();
}

let triggerActual = null;
function alEscape(event) {
  if (event.key === 'Escape') cerrar(triggerActual);
}

function abrirFormulario(existente, trigger) {
  if (overlay) return;
  triggerActual = trigger;
  const editando = Boolean(existente);

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'personal-titulo');

  const cerrarBtn = document.createElement('button');
  cerrarBtn.type = 'button';
  cerrarBtn.className = 'modal-close';
  cerrarBtn.setAttribute('aria-label', 'Cerrar');
  cerrarBtn.textContent = 'Cerrar';

  const titulo = document.createElement('h2');
  titulo.id = 'personal-titulo';
  titulo.className = 'modal-title';
  titulo.textContent = editando ? 'Editar trabajador' : 'Agregar trabajador';

  const subtitulo = document.createElement('p');
  subtitulo.className = 'modal-subtitle';
  subtitulo.textContent = 'Solo el nombre es obligatorio. Lo demás se completa en los documentos si falta.';

  const form = document.createElement('form');
  form.noValidate = true;

  const e = existente || {};
  const nombre = campo({ id: 'personal-nombre', label: 'Nombre completo', value: e.nombre, autocomplete: 'off', required: true });
  const cedula = campo({ id: 'personal-cedula', label: 'Cédula (opcional)', value: e.cedula, inputMode: 'numeric' });
  const cargo = campo({ id: 'personal-cargo', label: 'Cargo (opcional)', value: e.cargo, list: 'personal-cargos' });
  const datalist = document.createElement('datalist');
  datalist.id = 'personal-cargos';
  CARGOS.forEach((c) => { const o = document.createElement('option'); o.value = c; datalist.appendChild(o); });
  cargo.wrapper.appendChild(datalist);
  const eps = campo({ id: 'personal-eps', label: 'EPS (opcional)', value: e.eps, placeholder: '' });
  const arl = campo({ id: 'personal-arl', label: 'ARL (opcional)', value: e.arl });
  const telefono = campo({ id: 'personal-telefono', label: 'Teléfono (opcional)', value: e.telefono, type: 'tel', inputMode: 'tel' });

  form.appendChild(nombre.wrapper);
  const fila1 = document.createElement('div');
  fila1.className = 'form-row';
  fila1.appendChild(cedula.wrapper);
  fila1.appendChild(cargo.wrapper);
  form.appendChild(fila1);
  const fila2 = document.createElement('div');
  fila2.className = 'form-row';
  fila2.appendChild(eps.wrapper);
  fila2.appendChild(arl.wrapper);
  form.appendChild(fila2);
  form.appendChild(telefono.wrapper);

  const acciones = document.createElement('div');
  acciones.className = 'modal-actions';
  const guardar = document.createElement('button');
  guardar.type = 'submit';
  guardar.className = 'btn btn-primary';
  guardar.textContent = editando ? 'Guardar cambios' : 'Agregar al personal';
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'btn btn-secondary';
  cancelar.textContent = 'Cancelar';
  acciones.appendChild(guardar);
  acciones.appendChild(cancelar);
  if (editando) {
    const eliminar = document.createElement('button');
    eliminar.type = 'button';
    eliminar.className = 'btn btn-secondary settings-danger-btn';
    eliminar.textContent = 'Quitar del proyecto';
    eliminar.addEventListener('click', async () => {
      const ok = await confirmDialog({
        titleText: 'Quitar del personal',
        message: `"${e.nombre}" se quitará de la lista de este proyecto. Los documentos que ya generaste no cambian.`,
        confirmLabel: 'Quitar',
        confirmClassName: 'btn btn-secondary settings-danger-btn',
        restoreFocusTo: eliminar,
      });
      if (!ok) return;
      const { error } = await supabase.from('project_personnel').delete().eq('id', e.id);
      if (error) {
        console.error('Error al quitar al trabajador:', error);
        announce('No se pudo quitar al trabajador. Intenta de nuevo.');
        return;
      }
      cerrar(trigger);
      announce(`${e.nombre} fue quitado del personal.`);
      recargar();
    });
    acciones.appendChild(eliminar);
  }
  form.appendChild(acciones);

  dialog.appendChild(cerrarBtn);
  dialog.appendChild(titulo);
  dialog.appendChild(subtitulo);
  dialog.appendChild(form);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', alEscape);
  cerrarBtn.addEventListener('click', () => cerrar(trigger));
  cancelar.addEventListener('click', () => cerrar(trigger));
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cerrar(trigger); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFieldError(nombre.input);
    const valor = nombre.input.value.trim();
    if (!valor) {
      setFieldError(nombre.input, 'Escribe el nombre del trabajador.');
      nombre.input.focus();
      return;
    }

    const fila = {
      nombre: valor,
      cedula: cedula.input.value.trim() || null,
      cargo: cargo.input.value.trim() || null,
      eps: eps.input.value.trim() || null,
      arl: arl.input.value.trim() || null,
      telefono: telefono.input.value.trim() || null,
    };

    guardar.disabled = true;
    const textoOriginal = guardar.textContent;
    guardar.textContent = 'Guardando…';
    try {
      const { error } = editando
        ? await supabase.from('project_personnel').update({ ...fila, updated_at: new Date().toISOString() }).eq('id', e.id)
        : await supabase.from('project_personnel').insert({ ...fila, project_id: projectId });

      if (error) {
        console.error('Error al guardar al trabajador:', error);
        announce('No se pudo guardar. Intenta de nuevo.');
        return;
      }
      cerrar(trigger);
      announce(editando ? 'Cambios guardados.' : `${valor} se agregó al personal.`);
      recargar();
    } finally {
      guardar.disabled = false;
      guardar.textContent = textoOriginal;
    }
  });

  nombre.input.focus();
}

export async function initPersonal(id) {
  projectId = id;
  const agregar = document.getElementById('personal-agregar-btn');
  if (agregar) {
    agregar.addEventListener('click', () => abrirFormulario(null, agregar));
  }
  await recargar();
}