/**
 * exportar-bitacora.js
 * Exportación real de la bitácora del proyecto en formato de informe
 * técnico formal, mismo estilo que exportar.js usa para los
 * documentos generados por IA (Times New Roman, negro, sin colores
 * de marca) — pero con su propia estructura: agrupada por día,
 * fotografías organizadas en grilla, y transcripción de las notas de
 * voz cuando está disponible (en vez de solo "nota de voz, X min").
 *
 * PDF: jsPDF, cargado por <script> en bitacora.html (window.jspdf.jsPDF).
 * Word: HTML con estilos, guardado como .doc (Word lo abre con el
 * formato real, igual que exportar.js).
 */

import { formatDisplayDate, formatDisplayTime } from '../utils/fechas.js';

const TYPE_LABELS = {
  texto: 'Texto',
  fotografia: 'Fotografía',
  'nota-voz': 'Nota de voz',
};

const META_LABELS = ['Clima', 'Personal en obra', 'Maquinaria en obra', 'Observaciones'];

/**
 * Misma lógica de parseo que timeline.js: separa Clima/Personal/
 * Maquinaria/Observaciones del cuerpo libre de la novedad, para que
 * la exportación se vea igual de organizada que la pantalla.
 */
function parseStructuredContent(content) {
  if (!content) {
    return { meta: [], body: '' };
  }
  const lines = content.split('\n');
  const meta = [];
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const matchedLabel = META_LABELS.find((label) => line.startsWith(`${label}:`));
    if (matchedLabel && meta.length === i) {
      meta.push({ label: matchedLabel, value: line.slice(matchedLabel.length + 1).trim() });
      bodyStartIndex = i + 1;
    } else if (meta.length > 0 && line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    } else {
      break;
    }
  }

  return { meta, body: lines.slice(bodyStartIndex).join('\n').trim() };
}

function groupByDay(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const dayKey = new Date(entry.created_at).toISOString().slice(0, 10);
    if (!groups.has(dayKey)) {
      groups.set(dayKey, []);
    }
    groups.get(dayKey).push(entry);
  });
  return groups;
}

function formatearNombreArchivo(proyectoNombre, periodoLabel) {
  const base = `Bitacora - ${proyectoNombre} - ${periodoLabel}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return base || 'bitacora';
}

/**
 * Texto de una entrada, listo para imprimir: para "texto" separa los
 * chips de meta del cuerpo; para "nota-voz" usa la transcripción si
 * existe; para "fotografia" usa la descripción tal cual.
 */
function textoParaExportar(entry) {
  if (entry.type === 'texto') {
    const { meta, body } = parseStructuredContent(entry.content);
    const metaTexto = meta
      .filter((m) => m.value)
      .map((m) => `${m.label}: ${m.value}`)
      .join(' · ');
    return [metaTexto, body || entry.content || ''].filter(Boolean).join('\n');
  }

  if (entry.type === 'nota-voz') {
    if (entry.audio_transcription) {
      return `Transcripción: "${entry.audio_transcription}"`;
    }
    return '(Nota de voz sin transcripción disponible — se puede escuchar en la app.)';
  }

  return entry.content || '';
}

/* ============================================================================
   DESCARGA DE IMÁGENES A DATA URL (para incrustarlas en el PDF)
   Si una foto falla al descargar (sin conexión, permisos, etc.), no
   se rompe la exportación entera: esa foto simplemente se omite.
   ============================================================================ */
async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('No se pudo descargar una fotografía para la exportación:', error);
    return null;
  }
}

function dataUrlFormat(dataUrl) {
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

/* ============================================================================
   EXPORTAR A PDF
   ============================================================================ */
export async function exportarBitacoraPDF({ proyectoNombre, periodoLabel, entries }) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF no está disponible todavía. Espera a que la página termine de cargar.');
  }

  // Fotos primero, en paralelo, antes de empezar a dibujar el PDF.
  const photoDataUrls = new Map();
  const fotosAEntryId = [];
  entries.forEach((entry) => {
    if (entry.type === 'fotografia' && Array.isArray(entry.photo_urls)) {
      entry.photo_urls.forEach((url) => fotosAEntryId.push(url));
    }
  });
  await Promise.all(fotosAEntryId.map(async (url) => {
    const dataUrl = await fetchImageAsDataUrl(url);
    if (dataUrl) {
      photoDataUrls.set(url, dataUrl);
    }
  }));

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 64;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let y = 70;

  function nuevaPaginaSiNecesita(altura) {
    if (y + altura > pageHeight - 56) {
      doc.addPage();
      y = 70;
    }
  }

  doc.setTextColor(0, 0, 0);

  doc.setFont('times', 'bold');
  doc.setFontSize(15);
  doc.text('BITÁCORA DE OBRA', pageWidth / 2, y, { align: 'center' });
  y += 20;

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.text(`Proyecto: ${proyectoNombre}`, pageWidth / 2, y, { align: 'center' });
  y += 26;

  doc.setFontSize(10.5);
  const fechaHoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  [['Período:', periodoLabel], ['Fecha del informe:', fechaHoy]].forEach(([etiqueta, valor]) => {
    doc.setFont('times', 'bold');
    doc.text(etiqueta, marginX, y);
    doc.setFont('times', 'normal');
    doc.text(valor, marginX + 110, y);
    y += 15;
  });
  y += 12;

  const groups = groupByDay(entries);
  const sortedKeys = Array.from(groups.keys()).sort();

  sortedKeys.forEach((dayKey) => {
    y += 6;
    nuevaPaginaSiNecesita(24);
    doc.setFont('times', 'bold');
    doc.setFontSize(12.5);
    doc.text(formatDisplayDate(new Date(`${dayKey}T00:00:00`)), marginX, y);
    y += 8;
    doc.setLineWidth(0.75);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 16;

    const dayEntries = groups.get(dayKey).slice().sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    );

    dayEntries.forEach((entry) => {
      nuevaPaginaSiNecesita(30);
      doc.setFont('times', 'bold');
      doc.setFontSize(10.5);
      const hora = formatDisplayTime(new Date(entry.created_at));
      doc.text(`${hora} — ${TYPE_LABELS[entry.type] || entry.type}`, marginX, y);
      y += 15;

      const texto = textoParaExportar(entry);
      if (texto) {
        doc.setFont('times', 'normal');
        doc.setFontSize(11);
        const lineas = doc.splitTextToSize(texto, contentWidth);
        lineas.forEach((linea) => {
          nuevaPaginaSiNecesita(15);
          doc.text(linea, marginX, y, { maxWidth: contentWidth });
          y += 15;
        });
      }

      // Fotos en grilla de 3 columnas, tamaño uniforme.
      if (entry.type === 'fotografia' && Array.isArray(entry.photo_urls) && entry.photo_urls.length) {
        const columnas = 3;
        const gap = 8;
        const tamano = (contentWidth - gap * (columnas - 1)) / columnas;
        let col = 0;
        let filaAlturaMax = 0;

        entry.photo_urls.forEach((url) => {
          const dataUrl = photoDataUrls.get(url);
          if (!dataUrl) {
            return;
          }
          nuevaPaginaSiNecesita(tamano + 10);
          const x = marginX + col * (tamano + gap);
          try {
            doc.addImage(dataUrl, dataUrlFormat(dataUrl), x, y, tamano, tamano);
          } catch (error) {
            console.error('No se pudo insertar una fotografía en el PDF:', error);
          }
          filaAlturaMax = tamano;
          col += 1;
          if (col >= columnas) {
            col = 0;
            y += filaAlturaMax + gap;
            filaAlturaMax = 0;
          }
        });
        if (col !== 0) {
          y += filaAlturaMax + gap;
        }
      }

      y += 10;
    });

    y += 6;
  });

  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i += 1) {
    doc.setPage(i);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Página ${i} de ${totalPaginas}`, pageWidth / 2, pageHeight - 34, { align: 'center' });
  }

  doc.save(`${formatearNombreArchivo(proyectoNombre, periodoLabel)}.pdf`);
}

/* ============================================================================
   EXPORTAR A WORD
   ============================================================================ */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function exportarBitacoraWord({ proyectoNombre, periodoLabel, entries }) {
  const fechaHoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  const groups = groupByDay(entries);
  const sortedKeys = Array.from(groups.keys()).sort();

  const diasHtml = sortedKeys.map((dayKey) => {
    const dayEntries = groups.get(dayKey).slice().sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    );

    const entriesHtml = dayEntries.map((entry) => {
      const hora = formatDisplayTime(new Date(entry.created_at));
      const texto = textoParaExportar(entry);

      let fotosHtml = '';
      if (entry.type === 'fotografia' && Array.isArray(entry.photo_urls) && entry.photo_urls.length) {
        fotosHtml = `<div class="fotos-grid">${entry.photo_urls.map((url) => `<img src="${url}" class="foto-item">`).join('')}</div>`;
      }

      return `
        <p class="entrada-encabezado">${hora} — ${escapeHtml(TYPE_LABELS[entry.type] || entry.type)}</p>
        ${texto ? `<p class="entrada-texto">${escapeHtml(texto).replace(/\n/g, '<br>')}</p>` : ''}
        ${fotosHtml}
      `;
    }).join('\n');

    return `
      <p class="dia-titulo">${escapeHtml(formatDisplayDate(new Date(`${dayKey}T00:00:00`)))}</p>
      ${entriesHtml}
    `;
  }).join('\n');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Bitácora — ${escapeHtml(proyectoNombre)}</title>
<style>
  body { font-family: "Times New Roman", Times, serif; color: #000000; font-size: 12pt; }
  h1 { font-size: 15pt; font-weight: bold; text-align: center; margin: 0 0 4pt; text-transform: uppercase; }
  .proyecto { font-size: 13pt; font-weight: bold; text-align: center; margin: 0 0 18pt; }
  .info-tabla { font-size: 11pt; margin-bottom: 20pt; }
  .info-tabla td { padding: 2pt 0; }
  .info-tabla td.etiqueta { font-weight: bold; width: 140pt; }
  .dia-titulo { font-size: 13pt; font-weight: bold; margin: 20pt 0 8pt; border-bottom: 1pt solid #000; padding-bottom: 4pt; }
  .entrada-encabezado { font-size: 11pt; font-weight: bold; margin: 10pt 0 2pt; }
  .entrada-texto { font-size: 11.5pt; line-height: 1.4; margin: 0 0 6pt; }
  .fotos-grid { display: flex; flex-wrap: wrap; gap: 6pt; margin: 4pt 0 10pt; }
  .foto-item { width: 150pt; height: 150pt; object-fit: cover; border: 0.5pt solid #999; }
</style>
</head>
<body>
  <h1>Bitácora de obra</h1>
  <p class="proyecto">Proyecto: ${escapeHtml(proyectoNombre)}</p>

  <table class="info-tabla">
    <tr><td class="etiqueta">Período:</td><td>${escapeHtml(periodoLabel)}</td></tr>
    <tr><td class="etiqueta">Fecha del informe:</td><td>${fechaHoy}</td></tr>
  </table>

  ${diasHtml}
</body>
</html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formatearNombreArchivo(proyectoNombre, periodoLabel)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
