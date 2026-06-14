import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import './Import.css';

function formatAnomalyType(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateShort(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Import() {
  const [step, setStep] = useState('upload'); // upload | review | success
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sevFilter, setSevFilter] = useState('all');
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [viewingSession, setViewingSession] = useState(null);
  const fileRef = useRef(null);

  // Load previous sessions
  useEffect(() => {
    api.getImportSessions()
      .then(data => setSessions(data.sessions || []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  const handleFileSelect = (f) => {
    if (!f || !f.name.endsWith('.csv')) {
      setError('Please select a CSV file.');
      return;
    }
    setFile(f);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => setCsvText(e.target.result);
    reader.readAsText(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  };

  const handleUpload = async () => {
    if (!csvText) return;
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadCSV(csvText, file?.name || 'import.csv');
      setUploadResult(result);
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async () => {
    const sessionId = uploadResult?.session?.id || viewingSession?.id;
    if (!sessionId) return;
    if (!confirm('Approve this import? This will create expenses and settlements in your database.')) return;
    setApproving(true);
    setError('');
    try {
      const result = await api.approveImport(sessionId);
      setImportResult(result);
      setStep('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    const sessionId = uploadResult?.session?.id || viewingSession?.id;
    if (!sessionId) return;
    if (!confirm('Reject this import? All data will be discarded.')) return;
    setRejecting(true);
    try {
      await api.rejectImport(sessionId);
      setStep('upload');
      setUploadResult(null);
      setViewingSession(null);
      setFile(null);
      setCsvText('');
      // Reload sessions
      const data = await api.getImportSessions();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setRejecting(false);
    }
  };

  const viewSession = async (session) => {
    try {
      const data = await api.getImportSession(session.id);
      setViewingSession(data.session);
      setUploadResult({ session: data.session, anomalies: data.session.anomalies || [] });
      setStep('review');
    } catch (err) {
      setError(err.message);
    }
  };

  const anomalies = uploadResult?.anomalies || viewingSession?.anomalies || [];
  const filteredAnomalies = sevFilter === 'all'
    ? anomalies
    : anomalies.filter(a => a.severity === sevFilter);

  const errorCount = anomalies.filter(a => a.severity === 'error').length;
  const warningCount = anomalies.filter(a => a.severity === 'warning').length;
  const infoCount = anomalies.filter(a => a.severity === 'info').length;

  const currentStep = step === 'upload' ? 1 : step === 'review' ? 2 : 3;

  return (
    <div className="import-page page">
      <div className="container animate-fade-in">
        <div className="import-header">
          <h1>CSV Import</h1>
          <p>Upload expense data from a CSV file with automatic anomaly detection</p>
        </div>

        {/* Step Indicator */}
        <div className="step-indicator">
          <div className={`step ${currentStep >= 1 ? (currentStep > 1 ? 'done' : 'active') : ''}`}>
            <div className="step-number">{currentStep > 1 ? '✓' : '1'}</div>
            <span>Upload</span>
          </div>
          <div className={`step-divider ${currentStep > 1 ? 'done' : ''}`} />
          <div className={`step ${currentStep >= 2 ? (currentStep > 2 ? 'done' : 'active') : ''}`}>
            <div className="step-number">{currentStep > 2 ? '✓' : '2'}</div>
            <span>Review</span>
          </div>
          <div className={`step-divider ${currentStep > 2 ? 'done' : ''}`} />
          <div className={`step ${currentStep >= 3 ? 'active' : ''}`}>
            <div className="step-number">3</div>
            <span>Complete</span>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-lg)' }}><span>⚠</span> {error}</div>}

        {/* STEP 1: UPLOAD */}
        {step === 'upload' && (
          <div className="animate-fade-in">
            <div
              className={`dropzone ${dragOver ? 'drag-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
              <div className="dropzone-icon">📁</div>
              <div className="dropzone-title">
                {file ? file.name : 'Drag & drop your CSV file here'}
              </div>
              <div className="dropzone-subtitle">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : 'or click to browse'}
              </div>
              {file && (
                <div className="dropzone-file">📄 {file.name}</div>
              )}
            </div>

            {file && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-lg)' }}>
                <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={uploading}>
                  {uploading ? (
                    <>Uploading… <div className="spinner" style={{ marginLeft: 8 }} /></>
                  ) : (
                    'Upload & Analyze'
                  )}
                </button>
              </div>
            )}

            {/* Previous Imports */}
            <div className="prev-imports">
              <h3 className="prev-imports-title">Previous Imports</h3>
              {loadingSessions ? (
                <div className="skeleton" style={{ height: 60, borderRadius: 10, marginBottom: 8 }} />
              ) : sessions.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>No previous imports.</p>
              ) : (
                sessions.map(s => (
                  <div key={s.id} className="session-card" onClick={() => viewSession(s)}>
                    <div className="session-info">
                      <div className="session-filename">{s.filename}</div>
                      <div className="session-meta">{formatDateShort(s.createdAt)} · {s.totalRows} rows</div>
                    </div>
                    <div className="session-stats">
                      {s.anomalyCount > 0 && <span className="badge badge-warning">{s.anomalyCount} anomalies</span>}
                      <span className={`badge ${s.status === 'approved' ? 'badge-success' : s.status === 'rejected' ? 'badge-error' : 'badge-warning'}`}>
                        {s.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* STEP 2: REVIEW */}
        {step === 'review' && (
          <div className="animate-fade-in">
            {/* Summary */}
            <div className="import-summary">
              <div className="summary-stat">
                <div className="summary-stat-value">{uploadResult?.session?.totalRows || 0}</div>
                <div className="summary-stat-label">Total Rows</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value errors">{errorCount}</div>
                <div className="summary-stat-label">Errors</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value warnings">{warningCount}</div>
                <div className="summary-stat-label">Warnings</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value info">{infoCount}</div>
                <div className="summary-stat-label">Info</div>
              </div>
            </div>

            {/* Severity filters */}
            <div className="severity-filters">
              {[
                { key: 'all', label: `All (${anomalies.length})` },
                { key: 'error', label: `Errors (${errorCount})` },
                { key: 'warning', label: `Warnings (${warningCount})` },
                { key: 'info', label: `Info (${infoCount})` },
              ].map(f => (
                <button
                  key={f.key}
                  className={`sev-filter ${sevFilter === f.key ? 'active' : ''}`}
                  onClick={() => setSevFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Anomaly table */}
            {filteredAnomalies.length > 0 && (
              <div className="table-container" style={{ marginBottom: 'var(--space-lg)' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Type</th>
                      <th>Severity</th>
                      <th>Field</th>
                      <th>Original</th>
                      <th>Resolved</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAnomalies.map((a, i) => (
                      <tr key={i} className={`anomaly-row-${a.severity}`}>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{a.csvRowNumber}</td>
                        <td><span className="anomaly-type">{formatAnomalyType(a.anomalyType)}</span></td>
                        <td>
                          <span className={`badge badge-${a.severity}`}>
                            {a.severity}
                          </span>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)' }}>{a.field || '—'}</td>
                        <td className="anomaly-value" title={a.originalValue}>{a.originalValue || '—'}</td>
                        <td className="anomaly-value" title={a.resolvedValue}>{a.resolvedValue || '—'}</td>
                        <td>
                          <span className={`badge ${a.actionTaken === 'auto_fixed' ? 'badge-success' : a.actionTaken === 'flagged' ? 'badge-warning' : a.actionTaken === 'needs_review' ? 'badge-error' : 'badge-muted'}`}>
                            {a.actionTaken?.replace(/_/g, ' ') || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filteredAnomalies.length === 0 && (
              <div className="empty-state" style={{ padding: '32px 16px' }}>
                <div className="empty-state-icon">✅</div>
                <div className="empty-state-title">No anomalies{sevFilter !== 'all' ? ` of type "${sevFilter}"` : ''}</div>
              </div>
            )}

            {/* Action buttons */}
            {(uploadResult?.session?.status === 'pending') && (
              <div className="import-actions">
                <button className="btn btn-danger btn-lg" onClick={handleReject} disabled={rejecting}>
                  {rejecting ? 'Rejecting…' : '✕ Reject Import'}
                </button>
                <button className="btn btn-primary btn-lg" onClick={handleApprove} disabled={approving}>
                  {approving ? (
                    <>Approving… <div className="spinner" style={{ marginLeft: 8 }} /></>
                  ) : (
                    '✓ Approve & Import'
                  )}
                </button>
              </div>
            )}

            {uploadResult?.session?.status !== 'pending' && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-xl)' }}>
                <span className={`badge ${uploadResult?.session?.status === 'approved' ? 'badge-success' : 'badge-error'}`} style={{ fontSize: 'var(--text-sm)', padding: '8px 20px' }}>
                  This import was {uploadResult?.session?.status}
                </span>
                <div style={{ marginTop: 'var(--space-md)' }}>
                  <button className="btn btn-ghost" onClick={() => { setStep('upload'); setUploadResult(null); setViewingSession(null); }}>
                    ← Back to Upload
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: SUCCESS */}
        {step === 'success' && (
          <div className="import-success">
            <div className="import-success-icon">✅</div>
            <h2>Import Complete!</h2>
            <p>Your data has been successfully imported and committed.</p>
            <Link to="/dashboard" className="btn btn-primary btn-lg">
              Go to Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
