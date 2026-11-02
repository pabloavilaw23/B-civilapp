/**
 * exportacion.js — Exportación formal de documentos (PDF y Word)
 *
 * Trabaja con el documento ESTRUCTURADO que devuelve ai-bcivil:
 *   { codigo, titulo, metadatos, secciones[{titulo, bloques[]}], firmas, fuentes }
 * Bloques: parrafo · lista · tabla · alerta.
 *
 * Formato de informe técnico formal (para entregar a una interventoría o
 * a una entidad): Times New Roman, negro, sin colores de marca, tabla de
 * datos del documento, secciones numeradas, tablas con bordes, bloque de
 * firmas y numeración de páginas.
 *
 * PDF: jsPDF, cargado con <script> en documentos.html (window.jspdf).
 * Word: HTML con estilos guardado como .doc (Word lo abre con formato).
 *
 * MEMBRETE: si la persona configuró el membrete de su empresa
 * (Configuración → Membrete de documentos), cada página lleva el logo a
 * la izquierda y los datos de la empresa a la derecha. Se recibe como
 * segundo parámetro: { empresa, nit, direccion, telefono, correo, logo_url }.
 *
 * textoADocumento(): convierte el texto del formato anterior ("## ")
 * a documento estructurado, por si la función del servidor aún no se
 * ha actualizado.
 */

const FUENTES_MARCADOR = '\n---\nFuentes consultadas';

/* ============================================================================
   COMPATIBILIDAD: texto anterior → documento estructurado
   ============================================================================ */
export function textoADocumento(contenido, { titulo, proyecto, periodo }) {
  const texto = String(contenido || '');
  const idx = texto.indexOf(FUENTES_MARCADOR);
  const cuerpo = idx === -1 ? texto : texto.slice(0, idx);
  const fuentesRaw = idx === -1 ? '' : texto.slice(idx + FUENTES_MARCADOR.length);

  const secciones = [];
  let actual = null;
  cuerpo.split('\n').map((l) => l.trim()).filter(Boolean).forEach((linea) => {
    if (linea.startsWith('## ')) {
      actual = { titulo: linea.slice(3).replace(/^\d+[.)-]?\s*/, '').trim(), bloques: [] };
      secciones.push(actual);
      return;
    }
    if (!actual) {
      actual = { titulo: 'Contenido', bloques: [] };
      secciones.push(actual);
    }
    actual.bloques.push({ tipo: 'parrafo', texto: linea });
  });

  const fuentes = fuentesRaw.split('\n')
    .map((l) => l.replace(/^[-•]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('('))
    .map((l) => {
      const [fecha, tipo] = l.split('—').map((p) => p.trim());
      return { fecha: fecha || l, tipo: tipo || '' };
    });

  return {
    version: 1,
    codigo: '',
    titulo,
    metadatos: {
      proyecto, fecha: new Date().toISOString().slice(0, 10), ubicacion: '', elaborado_por: '', dirigido_a: '', asunto: periodo ? `Período: ${periodo}` : '',
    },
    secciones,
    firmas: [],
    fuentes,
  };
}

function nombreArchivo(doc) {
  const base = `${doc.codigo ? `${doc.codigo} ` : ''}${doc.titulo} - ${doc.metadatos.proyecto || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
  return base || 'documento';
}

/* ============================================================================
   MEMBRETE
   ============================================================================ */
function tieneMembrete(m) {
  return Boolean(m && (m.empresa || m.logo_url));
}

function lineaContacto(m) {
  return [m.direccion, m.telefono, m.correo].filter(Boolean).join(' · ');
}

/**
 * Descarga el logo y lo convierte a PNG (base64) con sus medidas, para
 * incrustarlo en el PDF. Si falla (sin conexión, archivo borrado), el
 * documento se exporta igual, solo sin logo.
 */
export async function cargarLogo(url) {
  if (!url) return null;
  try {
    const respuesta = await fetch(url, { mode: 'cors' });
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });
    const escala = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    return { data: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
  } catch (error) {
    console.warn('No se pudo cargar el logo del membrete:', error);
    return null;
  }
}

function fechaLarga(iso) {
  if (!iso) return '';
  const fecha = new Date(`${iso}T12:00:00`);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function filasMetadatos(doc) {
  const m = doc.metadatos || {};
  return [
    ['Código', doc.codigo],
    ['Proyecto', m.proyecto],
    ['Fecha', fechaLarga(m.fecha)],
    ['Ubicación', m.ubicacion],
    ['Elaborado por', m.elaborado_por],
    ['Dirigido a', m.dirigido_a],
    ['Asunto', m.asunto],
  ].filter(([, v]) => v);
}

/* ============================================================================
   PDF (jsPDF)
   ============================================================================ */
export async function exportarDocumentoPDF(doc, membrete = null) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF no está disponible todavía. Espera a que la página termine de cargar.');
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });

  const M = 60; // margen
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const CW = W - M * 2;
  const conMembrete = tieneMembrete(membrete);
  const logo = conMembrete ? await cargarLogo(membrete.logo_url) : null;
  const BOTTOM = H - 64;
  const TOP = conMembrete ? 112 : 64;
  let y = TOP;

  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);

  const salto = (alto) => {
    if (y + alto > BOTTOM) {
      pdf.addPage();
      y = TOP;
      return true;
    }
    return false;
  };

  const fuente = (estilo, tam) => {
    pdf.setFont('times', estilo);
    pdf.setFontSize(tam);
  };

  /* Tabla genérica con bordes; repite el encabezado en cada página */
  const tabla = (columnas, filas, anchos) => {
    const n = columnas.length;
    const widths = anchos || Array(n).fill(CW / n);
    const pad = 5;
    const lh = 12.5;

    const alturaFila = (celdas, estilo) => {
      fuente(estilo, 9.5);
      return Math.max(...celdas.map((c, i) => pdf.splitTextToSize(String(c || ''), widths[i] - pad * 2).length)) * lh + pad * 2 - 2;
    };

    const dibujarFila = (celdas, estilo, relleno) => {
      const h = alturaFila(celdas, estilo);
      let x = M;
      celdas.forEach((c, i) => {
        if (relleno) {
          pdf.setFillColor(235, 235, 235);
          pdf.rect(x, y, widths[i], h, 'FD');
        } else {
          pdf.rect(x, y, widths[i], h);
        }
        fuente(estilo, 9.5);
        pdf.text(pdf.splitTextToSize(String(c || ''), widths[i] - pad * 2), x + pad, y + pad + 8.5);
        x += widths[i];
      });
      y += h;
    };

    pdf.setLineWidth(0.6);
    if (columnas.some(Boolean)) {
      salto(alturaFila(columnas, 'bold') + alturaFila(filas[0] || columnas, 'normal'));
      dibujarFila(columnas, 'bold', true);
    }
    filas.forEach((fila) => {
      if (salto(alturaFila(fila, 'normal')) && columnas.some(Boolean)) {
        dibujarFila(columnas, 'bold', true);
      }
      dibujarFila(fila, 'normal', false);
    });
    y += 10;
  };

  /* ---------------------------- Encabezado ---------------------------- */
  fuente('bold', 15);
  pdf.splitTextToSize(String(doc.titulo || '').toUpperCase(), CW).forEach((linea) => {
    pdf.text(linea, W / 2, y, { align: 'center' });
    y += 19;
  });
  y += 6;

  // Datos del documento en tabla de dos columnas
  const meta = filasMetadatos(doc);
  if (meta.length) {
    const pad = 5;
    pdf.setLineWidth(0.6);
    meta.forEach(([etiqueta, valor]) => {
      fuente('normal', 10);
      const lineas = pdf.splitTextToSize(String(valor), CW - 120 - pad * 2);
      const h = lineas.length * 13 + pad * 2 - 2;
      salto(h);
      pdf.setFillColor(242, 242, 242);
      pdf.rect(M, y, 120, h, 'FD');
      pdf.rect(M + 120, y, CW - 120, h);
      fuente('bold', 10);
      pdf.text(etiqueta, M + pad, y + pad + 9);
      fuente('normal', 10);
      pdf.text(lineas, M + 120 + pad, y + pad + 9);
      y += h;
    });
    y += 16;
  }

  /* ----------------------------- Secciones ----------------------------- */
  let numero = 0;
  (doc.secciones || []).forEach((seccion) => {
    const esAdvertencia = seccion.titulo === 'Advertencia';
    if (!esAdvertencia) {
      numero += 1;
      y += 8;
      salto(40);
      fuente('bold', 12);
      pdf.text(pdf.splitTextToSize(`${numero}. ${seccion.titulo}`, CW), M, y);
      y += 18;
    }

    (seccion.bloques || []).forEach((b) => {
      if (b.tipo === 'tabla') {
        tabla(b.columnas || [], b.filas || []);
        return;
      }

      if (b.tipo === 'lista') {
        fuente('normal', 11);
        (b.items || []).forEach((item) => {
          const lineas = pdf.splitTextToSize(String(item), CW - 16);
          lineas.forEach((linea, i) => {
            salto(15);
            if (i === 0) pdf.text('•', M + 4, y);
            pdf.text(linea, M + 16, y);
            y += 15;
          });
        });
        y += 6;
        return;
      }

      if (b.tipo === 'alerta') {
        fuente('italic', 10);
        const lineas = pdf.splitTextToSize(String(b.texto || ''), CW - 24);
        const h = lineas.length * 13 + 14;
        salto(h);
        pdf.setFillColor(244, 244, 244);
        pdf.setLineWidth(0.6);
        pdf.rect(M, y, CW, h, 'FD');
        pdf.setLineWidth(2.5);
        pdf.line(M, y, M, y + h);
        pdf.setLineWidth(0.6);
        pdf.text(lineas, M + 12, y + 16);
        y += h + 10;
        return;
      }

      // Párrafo
      fuente('normal', 11);
      const lineas = pdf.splitTextToSize(String(b.texto || ''), CW);
      lineas.forEach((linea, i) => {
        salto(15);
        const esUltima = i === lineas.length - 1;
        pdf.text(linea, M, y, esUltima ? undefined : { align: 'justify', maxWidth: CW });
        y += 15;
      });
      y += 7;
    });
    y += 4;
  });

  /* ------------------------------- Firmas ------------------------------- */
  const firmas = doc.firmas || [];
  if (firmas.length) {
    y += 16;
    const colW = CW / 2;
    for (let i = 0; i < firmas.length; i += 2) {
      salto(80);
      y += 40;
      [firmas[i], firmas[i + 1]].forEach((f, j) => {
        if (!f) return;
        const x = M + j * colW + 10;
        const w = colW - 30;
        pdf.setLineWidth(0.8);
        pdf.line(x, y, x + w, y);
        fuente('bold', 10);
        pdf.text(pdf.splitTextToSize(String(f.nombre || ''), w), x, y + 14);
        fuente('normal', 9.5);
        pdf.text(pdf.splitTextToSize(String(f.cargo || ''), w), x, y + 27);
      });
      y += 44;
    }
  }

  /* --------------------- Registros de bitácora usados --------------------- */
  const fuentes = doc.fuentes || [];
  if (fuentes.length) {
    y += 14;
    salto(60);
    fuente('bold', 11);
    pdf.text('Registros de bitácora consultados', M, y);
    y += 12;
    tabla(['Fecha y hora', 'Tipo de registro'], fuentes.map((f) => [f.fecha, f.tipo]), [CW * 0.55, CW * 0.45]);
  }

  /* ------------------- Membrete y pie de página ------------------- */
  const dibujarMembrete = () => {
    const altoCaja = 46;
    let xTexto = M;
    let anchoTexto = CW;
    let alinear = 'left';

    if (logo) {
      const escala = Math.min(120 / logo.w, altoCaja / logo.h);
      const lw = logo.w * escala;
      const lh = logo.h * escala;
      pdf.addImage(logo.data, 'PNG', M, 30 + (altoCaja - lh) / 2, lw, lh, 'logo-membrete', 'FAST');
      xTexto = W - M;
      anchoTexto = CW - lw - 24;
      alinear = 'right';
    }

    let ty = 40;
    if (membrete.empresa) {
      fuente('bold', 11);
      pdf.splitTextToSize(String(membrete.empresa), anchoTexto).slice(0, 2).forEach((l) => {
        pdf.text(l, xTexto, ty, { align: alinear });
        ty += 13;
      });
    }
    fuente('normal', 8.5);
    pdf.setTextColor(60, 60, 60);
    if (membrete.nit) {
      pdf.text(`NIT ${membrete.nit}`, xTexto, ty, { align: alinear });
      ty += 11;
    }
    const contacto = lineaContacto(membrete);
    if (contacto) {
      pdf.splitTextToSize(contacto, anchoTexto).slice(0, 2).forEach((l) => {
        pdf.text(l, xTexto, ty, { align: alinear });
        ty += 10.5;
      });
    }
    pdf.setTextColor(0, 0, 0);
    pdf.setLineWidth(0.8);
    pdf.line(M, 86, W - M, 86);
  };

  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    pdf.setPage(i);
    if (conMembrete) dibujarMembrete();
    fuente('normal', 8.5);
    pdf.setTextColor(70, 70, 70);
    const pieIzquierdo = [conMembrete ? membrete.empresa : '', doc.codigo].filter(Boolean).join(' · ');
    if (pieIzquierdo) pdf.text(pdf.splitTextToSize(pieIzquierdo, CW - 90)[0], M, H - 34);
    pdf.text(`Página ${i} de ${total}`, W - M, H - 34, { align: 'right' });
    pdf.setTextColor(0, 0, 0);
  }

  pdf.save(`${nombreArchivo(doc)}.pdf`);
}

/* ============================================================================
   WORD (HTML con formato, guardado como .doc)
   ============================================================================ */
function esc(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

export function exportarDocumentoWord(doc, membrete = null) {
  const meta = filasMetadatos(doc)
    .map(([k, v]) => `<tr><td class="etq">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');

  let numero = 0;
  const secciones = (doc.secciones || []).map((s) => {
    const esAdvertencia = s.titulo === 'Advertencia';
    const titulo = esAdvertencia ? '' : `<p class="sec">${(numero += 1)}. ${esc(s.titulo)}</p>`;
    const bloques = (s.bloques || []).map((b) => {
      if (b.tipo === 'lista') return `<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      if (b.tipo === 'tabla') {
        return `<table class="tabla"><tr>${(b.columnas || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${
          (b.filas || []).map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      if (b.tipo === 'alerta') return `<p class="alerta">${esc(b.texto)}</p>`;
      return `<p class="par">${esc(b.texto)}</p>`;
    }).join('\n');
    return `${titulo}\n${bloques}`;
  }).join('\n');

  const firmas = (doc.firmas || []).length
    ? `<table class="firmas"><tr>${doc.firmas.map((f, i) => `${i && i % 2 === 0 ? '</tr><tr>' : ''}<td><br><br><br>______________________________<br><b>${esc(f.nombre)}</b><br>${esc(f.cargo)}</td>`).join('')}</tr></table>`
    : '';

  const fuentes = (doc.fuentes || []).length
    ? `<p class="sec">Registros de bitácora consultados</p><table class="tabla"><tr><th>Fecha y hora</th><th>Tipo de registro</th></tr>${
      doc.fuentes.map((f) => `<tr><td>${esc(f.fecha)}</td><td>${esc(f.tipo)}</td></tr>`).join('')}</table>`
    : '';

  // Word descarga el logo desde su dirección pública al abrir el archivo
  const membreteHtml = tieneMembrete(membrete)
    ? `<table class="membrete"><tr>
        <td class="membrete-logo">${membrete.logo_url ? `<img src="${esc(membrete.logo_url)}" height="56" alt="">` : ''}</td>
        <td class="membrete-datos">
          ${membrete.empresa ? `<b>${esc(membrete.empresa)}</b><br>` : ''}
          ${membrete.nit ? `NIT ${esc(membrete.nit)}<br>` : ''}
          ${esc(lineaContacto(membrete))}
        </td>
      </tr></table>`
    : '';

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(doc.titulo)}</title>
<style>
  @page { size: 8.5in 11in; margin: 2.2cm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; }
  h1 { font-size: 15pt; text-align: center; text-transform: uppercase; margin: 0 0 12pt; }
  table { border-collapse: collapse; width: 100%; }
  .meta td { border: 1pt solid #000; padding: 4pt 6pt; font-size: 10.5pt; vertical-align: top; }
  .meta td.etq { width: 120pt; font-weight: bold; background: #F2F2F2; }
  .sec { font-size: 12.5pt; font-weight: bold; margin: 16pt 0 6pt; }
  .par { text-align: justify; line-height: 1.5; margin: 0 0 8pt; }
  ul { margin: 0 0 8pt 18pt; }
  .tabla { margin: 4pt 0 10pt; font-size: 10pt; }
  .tabla th, .tabla td { border: 1pt solid #000; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  .tabla th { background: #EBEBEB; font-weight: bold; }
  .alerta { border: 1pt solid #000; border-left: 3pt solid #000; background: #F4F4F4; padding: 6pt 8pt; font-style: italic; font-size: 10.5pt; margin: 4pt 0 10pt; }
  .firmas { margin-top: 24pt; }
  .firmas td { width: 50%; padding: 6pt 10pt 14pt; font-size: 10.5pt; vertical-align: bottom; }
  .membrete { border-bottom: 1.5pt solid #000; margin-bottom: 14pt; }
  .membrete td { padding: 0 0 8pt; vertical-align: middle; }
  .membrete-logo { width: 40%; }
  .membrete-datos { text-align: right; font-size: 9pt; color: #333; }
  .membrete-datos b { font-size: 11pt; color: #000; }
</style>
</head>
<body>
  ${membreteHtml}
  <h1>${esc(doc.titulo)}</h1>
  ${meta ? `<table class="meta">${meta}</table><br>` : ''}
  ${secciones}
  ${firmas}
  ${fuentes}
</body>
</html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombreArchivo(doc)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================================================================
   NOMBRES ANTERIORES (compatibilidad): texto con "## " → documento
   ============================================================================ */
export function exportarPDF({ tipoDocumento, proyectoNombre, periodoLabel, contenido }) {
  return exportarDocumentoPDF(textoADocumento(contenido, { titulo: tipoDocumento, proyecto: proyectoNombre, periodo: periodoLabel }));
}

export function exportarWord({ tipoDocumento, proyectoNombre, periodoLabel, contenido }) {
  exportarDocumentoWord(textoADocumento(contenido, { titulo: tipoDocumento, proyecto: proyectoNombre, periodo: periodoLabel }));
}