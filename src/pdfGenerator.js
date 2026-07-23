import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import Papa from 'papaparse';

/* ═══════════════════════════════════════════════════
   CSV PARSING
   ═══════════════════════════════════════════════════ */
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error:    (err) => reject(err),
    });
  });
}

/* ═══════════════════════════════════════════════════
   SLOT FILTER
   ═══════════════════════════════════════════════════ */
function normalizeSlot(s) {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-')
    .toLowerCase();
}

export function filterOrders(rows, selectedDate, csvSlotValue) {
  const [y, m, d] = selectedDate.split('-');
  const targetDate = `${d}-${m}-${y}`;
  const normSlot   = normalizeSlot(csvSlotValue);

  return rows.filter((row) => {
    const rowDate = (row['Order Slot Date'] || '').trim();
    const rowSlot = (row['Order Slot Time'] || '').trim();
    return rowDate === targetDate && normalizeSlot(rowSlot) === normSlot;
  });
}

/* ═══════════════════════════════════════════════════
   ITEM LINE SLOT FILTER
   ═══════════════════════════════════════════════════ */
function itemLineMatchesSlot(line, csvSlotValue) {
  const commaIdx = line.indexOf(',');
  if (commaIdx === -1) return true;
  const afterName  = line.slice(commaIdx + 1).trim();
  const secondComma = afterName.indexOf(',');
  if (secondComma === -1) return true;
  const slotPart = afterName.slice(secondComma + 1).trim();
  return normalizeSlot(slotPart) === normalizeSlot(csvSlotValue);
}

/* ═══════════════════════════════════════════════════
   ITEM AGGREGATION  (Production list)
   ═══════════════════════════════════════════════════ */
export function aggregateProductionItems(filteredOrders, csvSlotValue) {
  const map = {};
  filteredOrders.forEach((order) => {
    const raw   = order['Items'] || '';
    const lines = raw.split(/\r?\n/);
    lines.forEach((line) => {
      const t = line.trim();
      if (!t) return;
      if (csvSlotValue && !itemLineMatchesSlot(t, csvSlotValue)) return;
      const match = t.match(/^(.*?)\s+x\s+(\d+)/);
      if (match) {
        const name = match[1].trim();
        const qty  = parseInt(match[2], 10);
        if (name) map[name] = (map[name] || 0) + qty;
      } else {
        const cleanName = t.split(',')[0].trim();
        if (cleanName) map[cleanName] = (map[cleanName] || 0) + 1;
      }
    });
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/* ═══════════════════════════════════════════════════
   DISTANCE SORT — descending
   ═══════════════════════════════════════════════════ */
function sortByDistance(orders) {
  return [...orders].sort((a, b) => {
    const rawA = (a['Distance From Outlet'] || '').trim();
    const rawB = (b['Distance From Outlet'] || '').trim();
    const da   = parseFloat(rawA);
    const db   = parseFloat(rawB);
    const aOk  = rawA !== '' && !isNaN(da);
    const bOk  = rawB !== '' && !isNaN(db);
    if (!aOk && !bOk) return 0;
    if (!aOk) return  1;
    if (!bOk) return -1;
    return db - da;
  });
}

/* ═══════════════════════════════════════════════════
   HELPER — format date
   ═══════════════════════════════════════════════════ */
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

/* ═══════════════════════════════════════════════════
   HELPER — format distance (0 / empty → "TA")
   ═══════════════════════════════════════════════════ */
function fmtDist(raw) {
  const v = (raw || '').trim();
  if (v === '' || v === '0' || parseFloat(v) === 0) return 'TA';
  return v;
}

/* ═══════════════════════════════════════════════════
   CARLITO FONT LOADER
   Fetches Carlito-Regular.ttf & Carlito-Bold.ttf from
   /fonts/, converts to base64, registers with jsPDF.
   Carlito is metrically identical to Calibri (free,
   licensed under SIL OFL 1.1).
   ═══════════════════════════════════════════════════ */
async function arrayBufferToBase64(buffer) {
  return new Promise((resolve) => {
    const blob   = new Blob([buffer]);
    const reader = new FileReader();
    reader.onload  = () => {
      const b64 = reader.result.split(',')[1];
      resolve(b64);
    };
    reader.readAsDataURL(blob);
  });
}

let _fontCache = null;  // { normal: base64, bold: base64 }

async function getFontData() {
  if (_fontCache) return _fontCache;

  const [normalBuf, boldBuf] = await Promise.all([
    fetch('/fonts/Carlito-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/Carlito-Bold.ttf').then((r) => r.arrayBuffer()),
  ]);

  _fontCache = {
    normal: await arrayBufferToBase64(normalBuf),
    bold:   await arrayBufferToBase64(boldBuf),
  };
  return _fontCache;
}

async function applyFont(doc) {
  const { normal, bold } = await getFontData();
  doc.addFileToVFS('Carlito-Regular.ttf', normal);
  doc.addFileToVFS('Carlito-Bold.ttf',    bold);
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
  doc.addFont('Carlito-Bold.ttf',    'Carlito', 'bold');
  doc.setFont('Carlito', 'normal');
}

/* ═══════════════════════════════════════════════════
   PRODUCTION PDF
   Portrait · Letter (612 × 792 pt)
   Columns: Item Name | Total Quantity
   Font: Calibri 12 · Header label 14
   Row height: 27 · Full-width columns
   ═══════════════════════════════════════════════════ */
export async function generateProductionPDF(aggregatedItems, dateStr, slotDef) {
  const doc    = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const PAGE_W = 612;
  const MARGIN = 40;

  await applyFont(doc);

  // ── Header ───────────────────────────────────────
  const headerLine = `Date: ${fmtDate(dateStr)}    Slot: ${slotDef.label}  (${slotDef.time})`;
  doc.setFont('Carlito', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(headerLine, MARGIN, 38);

  // ── Column widths (fill TABLE_W = 532 pt) ────────
  const TABLE_W  = PAGE_W - MARGIN * 2;   // 532 pt
  const W_QTY    = 80;
  const W_NAME   = TABLE_W - W_QTY;       // 452 pt

  doc.autoTable({
    startY:     54,
    head:       [['Item Name', 'Total Quantity']],
    body:       aggregatedItems.map(([name, qty]) => [name, qty.toString()]),
    theme:      'grid',
    margin:     { left: MARGIN, right: MARGIN },
    tableWidth: TABLE_W,
    styles: {
      font:          'Carlito',
      fontStyle:     'normal',
      fontSize:      12,
      textColor:     [0, 0, 0],
      fillColor:     false,
      lineColor:     [0, 0, 0],
      lineWidth:     0.5,
      cellPadding:   { top: 5, bottom: 5, left: 5, right: 5 },
      minCellHeight: 27,
      valign:        'middle',
      overflow:      'linebreak',
    },
    headStyles: {
      font:      'Carlito',
      fontStyle: 'bold',
      fontSize:  12,
      fillColor: false,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      valign:    'middle',
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0: { cellWidth: W_NAME  },
      1: { cellWidth: W_QTY, halign: 'center' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont('Carlito', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(headerLine, MARGIN, 38);
      }
    },
  });

  return doc;
}

/* ═══════════════════════════════════════════════════
   DISPATCH PDF
   Landscape · Letter (792 × 612 pt)
   Columns: Order No | Items | Distance | Order Instructions
   Font: Calibri 12 · Header label 14
   Row height: 27 · Full-width columns
   Distance = 0 shown as "TA"
   ═══════════════════════════════════════════════════ */
export async function generateDispatchPDF(filteredOrders, dateStr, slotDef) {
  const doc    = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const PAGE_W = 792;
  const MARGIN = 30;

  await applyCalibri(doc);

  const sorted = sortByDistance(filteredOrders);

  // ── Header ───────────────────────────────────────
  const headerLine = `Date: ${fmtDate(dateStr)}    Slot: ${slotDef.label}  (${slotDef.time})`;
  doc.setFont('Calibri', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(headerLine, MARGIN, 26);

  // ── Column widths (fill TABLE_W = 732 pt) ────────
  // Order No | Items | Distance | Order Instructions
  const TABLE_W   = PAGE_W - MARGIN * 2;  // 732 pt
  const W_ORDERNO = 68;
  const W_DIST    = 64;
  const W_ITEMS   = 220;
  const W_INSTR   = TABLE_W - W_ORDERNO - W_DIST - W_ITEMS;  // 380 pt

  // ── Build body ───────────────────────────────────
  const csvSlotValue = slotDef.csvValue;
  const body = sorted.map((order) => {
    const rawItems   = order['Items'] || '';
    const cleanItems = rawItems
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((t) => t && itemLineMatchesSlot(t, csvSlotValue))
      .map((t) => {
        const m = t.match(/^(.*?\s+x\s+\d+)/);
        return m ? m[1].trim() : t.split(',')[0].trim();
      })
      .filter((l) => l.length > 0)
      .join('\n');

    return [
      order['Order No']           || '',
      cleanItems,
      fmtDist(order['Distance From Outlet']),
      order['Order Instructions'] || '',
    ];
  });

  doc.autoTable({
    startY:     40,
    head:       [['Order No', 'Items', 'Distance', 'Order Instructions']],
    body,
    theme:      'grid',
    margin:     { left: MARGIN, right: MARGIN },
    tableWidth: TABLE_W,
    styles: {
      font:          'Carlito',
      fontStyle:     'normal',
      fontSize:      12,
      textColor:     [0, 0, 0],
      fillColor:     false,
      lineColor:     [0, 0, 0],
      lineWidth:     0.5,
      cellPadding:   { top: 5, bottom: 5, left: 5, right: 5 },
      minCellHeight: 27,
      valign:        'top',
      overflow:      'linebreak',
    },
    headStyles: {
      font:      'Carlito',
      fontStyle: 'bold',
      fontSize:  12,
      fillColor: false,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      valign:    'middle',
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0: { cellWidth: W_ORDERNO, halign: 'center' },
      1: { cellWidth: W_ITEMS   },
      2: { cellWidth: W_DIST,   halign: 'center' },
      3: { cellWidth: W_INSTR   },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont('Carlito', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(headerLine, MARGIN, 26);
      }
    },
  });

  return doc;
}

/* ═══════════════════════════════════════════════════
   RAPIDO PDF
   Landscape · Letter (792 × 612 pt)
   Columns: Order No | Distance | Order Instructions
   Font: Calibri 12 · Header label 14
   Row height: 27 · Full-width columns
   Distance = 0 shown as "TA"
   ═══════════════════════════════════════════════════ */
export async function generateRapidoPDF(filteredOrders, dateStr, slotDef) {
  const doc    = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const PAGE_W = 792;
  const MARGIN = 30;

  await applyCalibri(doc);

  const sorted = sortByDistance(filteredOrders);

  // ── Header ───────────────────────────────────────
  const headerLine = `Date: ${fmtDate(dateStr)}    Slot: ${slotDef.label}  (${slotDef.time})`;
  doc.setFont('Calibri', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(headerLine, MARGIN, 26);

  // ── Column widths (fill TABLE_W = 732 pt) ────────
  // Order No | Distance | Order Instructions
  const TABLE_W   = PAGE_W - MARGIN * 2;  // 732 pt
  const W_ORDERNO = 80;
  const W_DIST    = 80;
  const W_INSTR   = TABLE_W - W_ORDERNO - W_DIST;  // 572 pt

  const body = sorted.map((order) => [
    order['Order No']           || '',
    fmtDist(order['Distance From Outlet']),
    order['Order Instructions'] || '',
  ]);

  doc.autoTable({
    startY:     40,
    head:       [['Order No', 'Distance', 'Order Instructions']],
    body,
    theme:      'grid',
    margin:     { left: MARGIN, right: MARGIN },
    tableWidth: TABLE_W,
    styles: {
      font:          'Calibri',
      fontStyle:     'normal',
      fontSize:      12,
      textColor:     [0, 0, 0],
      fillColor:     false,
      lineColor:     [0, 0, 0],
      lineWidth:     0.5,
      cellPadding:   { top: 5, bottom: 5, left: 5, right: 5 },
      minCellHeight: 27,
      valign:        'top',
      overflow:      'linebreak',
    },
    headStyles: {
      font:      'Calibri',
      fontStyle: 'bold',
      fontSize:  12,
      fillColor: false,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      valign:    'middle',
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0: { cellWidth: W_ORDERNO, halign: 'center' },
      1: { cellWidth: W_DIST,   halign: 'center' },
      2: { cellWidth: W_INSTR  },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont('Calibri', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(headerLine, MARGIN, 26);
      }
    },
  });

  return doc;
}
