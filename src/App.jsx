import React, { useState, useRef } from 'react';
import {
  Calendar,
  UploadCloud,
  FileSpreadsheet,
  FileDown,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Check,
} from 'lucide-react';
import {
  parseCSV,
  filterOrders,
  aggregateProductionItems,
  generateProductionPDF,
  generateDispatchPDF,
  generateRapidoPDF,
} from './pdfGenerator';

const SLOTS = [
  {
    key: 'morning',
    label: 'Morning Slot',
    time: '10:30 AM – 02:00 PM',
    icon: '🌅',
    csvValue: '10:30 AM - 02:00 PM',
  },
  {
    key: 'evening',
    label: 'Evening Slot',
    time: '05:30 PM – 09:00 PM',
    icon: '🌆',
    csvValue: '05:30 PM - 09:00 PM',
  },
];

export default function App() {
  const [file, setFile] = useState(null);
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [slot, setSlot] = useState('morning');

  const [isDragActive, setIsDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [results, setResults] = useState(null);

  const fileInputRef = useRef(null);

  // ── Drag & Drop ──────────────────────────────────────────────────
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    setError('');
    const dropped = e.dataTransfer.files?.[0];
    if (dropped?.name.endsWith('.csv')) {
      setFile(dropped);
      setResults(null);
      showToast(`Loaded: ${dropped.name}`);
    } else {
      setError('Please upload a valid CSV file (.csv).');
    }
  };

  const handleFileChange = (e) => {
    setError('');
    const selected = e.target.files?.[0];
    if (selected?.name.endsWith('.csv')) {
      setFile(selected);
      setResults(null);
      showToast(`Loaded: ${selected.name}`);
    } else {
      setError('Please upload a valid CSV file (.csv).');
    }
  };

  const removeFile = () => {
    setFile(null);
    setResults(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Toast ────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  // ── Generate ─────────────────────────────────────────────────────
  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!file) { setError('Please upload a Master CSV file first.'); return; }
    if (!date)  { setError('Please select an order date.');           return; }

    setLoading(true);
    setError('');

    try {
      const rows = await parseCSV(file);
      const slotDef = SLOTS.find((s) => s.key === slot);
      const matchedOrders = filterOrders(rows, date, slotDef.csvValue);

      if (matchedOrders.length === 0) {
        const [y, m, d] = date.split('-');
        throw new Error(
          `No orders found for ${d}-${m}-${y} · ${slotDef.label}. Check the date and slot in your CSV.`
        );
      }

      const productionItems  = aggregateProductionItems(matchedOrders, slotDef.csvValue);
      const totalProductionQty = productionItems.reduce((acc, cur) => acc + cur[1], 0);

      const prodDoc     = await generateProductionPDF(productionItems, date, slotDef);
      const dispatchDoc = await generateDispatchPDF(matchedOrders, date, slotDef);
      const rapidoDoc   = await generateRapidoPDF(matchedOrders, date, slotDef);

      setResults({
        totalOrders:     matchedOrders.length,
        totalItemsCount: totalProductionQty,
        uniqueItemCount: productionItems.length,
        date,
        slotDef,
        documents: { production: prodDoc, dispatch: dispatchDoc, rapido: rapidoDoc },
      });

      showToast('All 3 PDFs generated successfully!');
    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred while processing the file.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Download ─────────────────────────────────────────────────────
  const downloadPDF = (docType) => {
    if (!results) return;
    const { documents, date, slotDef } = results;
    const doc = documents[docType];
    if (!doc) return;
    const slotTag = slotDef.key; // 'morning' / 'evening'
    const [y, m, d] = date.split('-');
    const filename = `${slotTag}_${docType}_${d}-${m}-${y}.pdf`;
    doc.save(filename);
    showToast(`Downloaded: ${filename}`);
  };

  // ── Date display ─────────────────────────────────────────────────
  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  };

  return (
    <div className="app-container">

      {/* ── Header ── */}
      <header className="app-header">
        <div className="logo-badge">
          🧁&nbsp;&nbsp;PASTRY KADAI
        </div>
        <h1 className="app-title">Order Management Automator</h1>
        <p className="app-subtitle">
          Upload your daily master CSV to instantly generate Production, Dispatch &amp; Rapido PDFs.
        </p>
      </header>

      {/* ── Main form card ── */}
      <main className="main-card">
        <form onSubmit={handleGenerate}>

          {/* Date selector */}
          <div className="date-row">
            <p className="section-label">
              <Calendar size={13} />
              Step 1 — Select Order Date
            </p>
            <label className="input-label" htmlFor="order-date">
              <Calendar size={14} className="text-secondary" />
              Order Date
            </label>
            <input
              id="order-date"
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setResults(null); }}
              className="date-picker"
              required
            />
          </div>

          {/* Slot selector */}
          <div className="slot-section">
            <p className="section-label">
              Step 2 — Select Delivery Slot
            </p>
            <div className="slot-toggle-group">
              {SLOTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`slot-btn${slot === s.key ? ' active' : ''}`}
                  onClick={() => { setSlot(s.key); setResults(null); }}
                >
                  {/* Checkmark badge */}
                  <span className="slot-check">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className="slot-icon">{s.icon}</span>
                  <span className="slot-name">{s.label}</span>
                  <span className="slot-time">{s.time}</span>
                </button>
              ))}
            </div>
          </div>

          {/* File upload */}
          <div>
            <p className="section-label">
              <FileSpreadsheet size={13} />
              Step 3 — Upload Master CSV
            </p>

            {!file ? (
              <div
                className={`upload-zone${isDragActive ? ' active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div className="upload-icon">
                  <UploadCloud size={26} />
                </div>
                <div className="upload-title">Drag &amp; drop your Master.csv here</div>
                <div className="upload-text">or click to browse your files</div>
              </div>
            ) : (
              <div className="file-selected-badge">
                <FileSpreadsheet size={18} />
                <span style={{ fontWeight: 600, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}&nbsp;&nbsp;
                  <span style={{ fontWeight: 400, opacity: 0.7 }}>({(file.size / 1024).toFixed(1)} KB)</span>
                </span>
                <button type="button" onClick={removeFile} className="remove-file-btn" title="Remove file">
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="error-box">
              <AlertCircle size={17} />
              {error}
            </div>
          )}

          {/* Generate button */}
          <button
            type="submit"
            className="generate-btn"
            disabled={loading || !file}
          >
            {loading ? (
              <>
                <div className="spinner" />
                Processing Master File…
              </>
            ) : (
              <>
                <RefreshCw size={18} />
                Generate All PDFs
              </>
            )}
          </button>
        </form>
      </main>

      {/* ── Results ── */}
      {results && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="results-header">
            <h2 className="results-heading">Generated Documents</h2>
            <div className="results-meta">
              <strong>{formatDateDisplay(results.date)}</strong>
              &nbsp;·&nbsp;
              <strong>{results.slotDef.label}</strong>
              &nbsp;&nbsp;({results.totalOrders} orders)
            </div>
          </div>

          <div className="results-container">

            {/* Production */}
            <div className="result-card">
              <div className="result-header">
                <div className="result-title-group">
                  <span className="result-tag tag-prod">Production</span>
                  <h3 className="result-title">Production List</h3>
                </div>
                <CheckCircle2 size={18} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
              </div>
              <div className="result-summary-box">
                <div className="summary-row">
                  <span className="summary-label">Unique Items</span>
                  <span className="summary-value">{results.uniqueItemCount}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Total Qty</span>
                  <span className="summary-value">{results.totalItemsCount}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Orientation</span>
                  <span className="summary-value">Portrait</span>
                </div>
              </div>
              <button onClick={() => downloadPDF('production')} className="download-btn">
                <FileDown size={15} /> Download PDF
              </button>
            </div>

            {/* Dispatch */}
            <div className="result-card card-dispatch">
              <div className="result-header">
                <div className="result-title-group">
                  <span className="result-tag tag-dispatch">Dispatch</span>
                  <h3 className="result-title">Dispatch List</h3>
                </div>
                <CheckCircle2 size={18} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
              </div>
              <div className="result-summary-box">
                <div className="summary-row">
                  <span className="summary-label">Total Orders</span>
                  <span className="summary-value">{results.totalOrders}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Sorted by</span>
                  <span className="summary-value">Distance ↓</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Orientation</span>
                  <span className="summary-value">Landscape</span>
                </div>
              </div>
              <button onClick={() => downloadPDF('dispatch')} className="download-btn">
                <FileDown size={15} /> Download PDF
              </button>
            </div>

            {/* Rapido */}
            <div className="result-card card-rapido">
              <div className="result-header">
                <div className="result-title-group">
                  <span className="result-tag tag-rapido">Rapido</span>
                  <h3 className="result-title">Rapido List</h3>
                </div>
                <CheckCircle2 size={18} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
              </div>
              <div className="result-summary-box">
                <div className="summary-row">
                  <span className="summary-label">Total Orders</span>
                  <span className="summary-value">{results.totalOrders}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Sorted by</span>
                  <span className="summary-value">Distance ↓</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Orientation</span>
                  <span className="summary-value">Landscape</span>
                </div>
              </div>
              <button onClick={() => downloadPDF('rapido')} className="download-btn">
                <FileDown size={15} /> Download PDF
              </button>
            </div>

          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <footer className="app-footer">
        © {new Date().getFullYear()} &nbsp;<span>Pastry Kadai</span>&nbsp; · Daily Workflow Automation
      </footer>

      {/* ── Toast ── */}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} style={{ color: 'var(--gold)' }} />
          {toast}
        </div>
      )}
    </div>
  );
}
