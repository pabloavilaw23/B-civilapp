/**
 * documentos-proyecto.js
 * MÓDULO 2 — CANTIDADES Y PRESUPUESTO: permite al usuario subir el
 * Excel de cantidades o el PDF de presupuesto que YA tiene, en vez de
 * volver a tipear esos datos a mano.
 *
 * - Excel (.xlsx / .xls): se extrae el texto de las celdas al momento
 *   de subir (con SheetJS) y se guarda en "texto_extraido". Es lo que
 *   la IA lee al generar un informe.
 * - PDF: no se extrae texto acá. Se guarda el archivo tal cual, y al
 *   generar un informe el servidor se lo pasa directo a la IA como
 *   documento nativo — lee mejor tablas y layouts complejos que una
 *   extracción manual de texto.
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';

// SheetJS por CDN como módulo ES — el proyecto no usa bundler, así
// que se importa directo, igual que cualquier otro import de este
// archivo.
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

const TIPO = 'cantidades_presupuesto';
const EXTENSIONES_PERMITIDAS = ['xlsx', 'xls', 'pdf'];
const MAX_TEXTO_EXTRAIDO = 40000; // caracteres — evita prompts gigantes

let projectId = null;

/* ============================================================================
   EXTRACCIÓN DE TEXTO DE EXCEL
   Recorre celda por celda (fila, columna, valor) de cada hoja, igual
   que se haría para inspeccionar el archivo a mano. No intenta
   adivinar la estructura semántica — eso lo interpreta la IA con el
   texto plano resultante.
   ============================================================================ */
function extraerTextoDeExcel(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const partes = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const filasHoja = [];

    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const celdas = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[address];
        if (cell && cell.v !== undefined && cell.v !== '') {
          const columnLetter = XLSX.utils.encode_col(c);
          celdas.push(`${columnLetter}${r + 1}: ${cell.v}`);
        }
      }
      if (celdas.length) {
        filasHoja.push(celdas.join(' | '));
      }
    }

    if (filasHoja.length) {
      partes.push(`--- Hoja: ${sheetName} ---\n${filasHoja.join('\n')}`);
    }
  });

  let texto = partes.join('\n\n');
  if (texto.length > MAX_TEXTO_EXTRAIDO) {
    texto = `${texto.slice(0, MAX_TEXTO_EXTRAIDO)}\n\n[Contenido truncado — el archivo es muy extenso para incluirlo completo.]`;
  }
  return texto;
}

/* ============================================================================
   SUBIDA DE ARCHIVO
   ============================================================================ */
function getExtension(filename) {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

async function subirArchivo(file) {
  const extension = getExtension(file.name);

  if (!EXTENSIONES_PERMITIDAS.includes(extension)) {
    announce('Solo se aceptan archivos .xlsx, .xls o .pdf.');
    return false;
  }

  let textoExtraido = null;

  if (extension === 'xlsx' || extension === 'xls') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      textoExtraido = extraerTextoDeExcel(arrayBuffer);
      if (!textoExtraido.trim()) {
        announce('No se encontró contenido legible en el Excel. Verifica el archivo.');
        return false;
      }
    } catch (error) {
      console.error('Error al leer el Excel:', error);
      announce('No se pudo leer el archivo Excel. Verifica que no esté dañado.');
      return false;
    }
  }

  const storagePath = `${projectId}/${Date.now()}-${file.name}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('project-documents')
      .upload(storagePath, file, { upsert: false });

    if (uploadError) {
      console.error('Error al subir el archivo:', uploadError);
      announce('No se pudo subir el archivo. Intenta de nuevo.');
      return false;
    }

    const { error: insertError } = await supabase.from('project_documents').insert({
      project_id: projectId,
      tipo: TIPO,
      nombre_archivo: file.name,
      storage_path: storagePath,
      formato: extension,
      texto_extraido: textoExtraido,
    });

    if (insertError) {
      console.error('Error al registrar el archivo:', insertError);
      announce('El archivo se subió pero no se pudo registrar. Intenta de nuevo.');
      return false;
    }

    announce(`"${file.name}" se subió correctamente.`);
    return true;
  } catch (error) {
    console.error('Error inesperado al subir el archivo:', error);
    announce('Ocurrió un error inesperado al subir el archivo.');
    return false;
  }
}

/* ============================================================================
   LISTADO Y ELIMINACIÓN
   ============================================================================ */
function formatIconFor(formato) {
  if (formato === 'pdf') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="15" y2="17"></line></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M8 4v16M16 4v16M3 10h18M3 16h18"></path></svg>';
}

function buildDocumentoItem(doc) {
  const li = document.createElement('li');
  li.className = 'doc-type-card';
  li.dataset.docId = doc.id;

  const top = document.createElement('div');
  top.style.display = 'flex';
  top.style.alignItems = 'center';
  top.style.gap = 'var(--space-3)';

  const icono = document.createElement('span');
  icono.className = 'doc-type-card-icon';
  icono.setAttribute('aria-hidden', 'true');
  icono.innerHTML = formatIconFor(doc.formato);

  const textos = document.createElement('span');
  textos.style.display = 'flex';
  textos.style.flexDirection = 'column';

  const nombre = document.createElement('span');
  nombre.className = 'doc-type-card-title';
  nombre.textContent = doc.nombre_archivo;

  const fecha = document.createElement('span');
  fecha.className = 'doc-type-card-desc';
  fecha.textContent = new Date(doc.created_at).toLocaleDateString('es-CO', { dateStyle: 'medium' });

  textos.appendChild(nombre);
  textos.appendChild(fecha);
  top.appendChild(icono);
  top.appendChild(textos);

  const eliminarBtn = document.createElement('button');
  eliminarBtn.type = 'button';
  eliminarBtn.className = 'btn btn-secondary';
  eliminarBtn.textContent = 'Eliminar';
  eliminarBtn.style.marginTop = 'var(--space-3)';
  eliminarBtn.addEventListener('click', () => eliminarDocumento(doc));

  li.appendChild(top);
  li.appendChild(eliminarBtn);
  return li;
}

async function cargarDocumentos() {
  const lista = document.getElementById('cantidades-lista');
  const emptyState = document.getElementById('cantidades-empty-state');
  if (!lista || !emptyState) {
    return;
  }

  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .eq('project_id', projectId)
    .eq('tipo', TIPO)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al cargar los documentos de cantidades y presupuesto:', error);
    return;
  }

  lista.innerHTML = '';

  if (!data || !data.length) {
    lista.hidden = true;
    emptyState.hidden = false;
    return;
  }

  lista.hidden = false;
  emptyState.hidden = true;
  data.forEach((doc) => lista.appendChild(buildDocumentoItem(doc)));
}

async function eliminarDocumento(doc) {
  try {
    const { error: storageError } = await supabase.storage
      .from('project-documents')
      .remove([doc.storage_path]);

    if (storageError) {
      console.error('Error al eliminar el archivo del almacenamiento:', storageError);
    }

    const { error } = await supabase
      .from('project_documents')
      .delete()
      .eq('id', doc.id);

    if (error) {
      console.error('Error al eliminar el registro del documento:', error);
      announce('No se pudo eliminar el archivo. Intenta de nuevo.');
      return;
    }

    announce(`"${doc.nombre_archivo}" fue eliminado.`);
    await cargarDocumentos();
  } catch (error) {
    console.error('Error inesperado al eliminar el documento:', error);
    announce('Ocurrió un error inesperado.');
  }
}

/* ============================================================================
   INICIALIZACIÓN — se llama desde proyecto.js una vez que se conoce
   el id del proyecto actual.
   ============================================================================ */
export function initDocumentosProyecto(currentProjectId) {
  projectId = currentProjectId;

  const input = document.getElementById('cantidades-file-input');
  const uploadBtn = document.getElementById('cantidades-upload-btn');
  if (!input || !uploadBtn) {
    return;
  }

  uploadBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) {
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Subiendo…';

    await subirArchivo(file);

    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Subir archivo';
    input.value = '';

    await cargarDocumentos();
  });

  cargarDocumentos();
}
