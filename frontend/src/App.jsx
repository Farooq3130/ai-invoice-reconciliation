import React, { useEffect, useState, useMemo } from 'react';
import { NavLink, Routes, Route, useNavigate, useParams, Navigate } from 'react-router-dom';
import api from './services/api';
import ChatBotPanel from './ChatBotPanel';

const ALL_NAV = [
  ['/', 'Dashboard', ['ADMIN', 'PURCHASER', 'WAREHOUSE', 'REVIEWER']],
  ['/invoices', 'Invoices', ['ADMIN', 'PURCHASER', 'REVIEWER']],
  ['/exceptions', 'Approval Queue', ['ADMIN', 'REVIEWER']],
  ['/upload', 'Invoice Upload', ['ADMIN', 'PURCHASER']],
  ['/bulk', 'Bulk Upload', ['ADMIN', 'PURCHASER']],
  ['/purchase-orders', 'Purchase Orders', ['ADMIN', 'PURCHASER', 'WAREHOUSE', 'REVIEWER']],
  ['/deliveries', 'Deliveries & GRNs', ['ADMIN', 'PURCHASER', 'WAREHOUSE', 'REVIEWER']],
  ['/batches', 'Batch Processing', ['ADMIN']],
  ['/audit', 'Audit History', ['ADMIN']]
];

function getRoleTagClass(role) {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN') return 'role-tag-admin';
  if (r === 'PURCHASER') return 'role-tag-purchaser';
  if (r === 'WAREHOUSE') return 'role-tag-warehouse';
  return 'role-tag-admin';
}

function getRoleLabel(role) {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN') return '👑 ADMIN';
  if (r === 'PURCHASER') return '🛒 PURCHASER';
  if (r === 'WAREHOUSE') return '📦 WAREHOUSE';
  return r;
}

const money = n =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(n || 0);

function Status({ children }) {
  const s = String(children || '').toUpperCase();
  const cls = s.toLowerCase().replace(/_/g, '-');
  return <span className={`badge ${cls}`}>{s.replace(/_/g, ' ')}</span>;
}

function Title({ title, text, action }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function Table({ cols, rows, emptyMsg = 'No records found.' }) {
  return (
    <section className="card tablewrap">
      <table>
        <thead>
          <tr>
            {cols.map(x => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', margin: 0 }}>
          {emptyMsg}
        </p>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Decision Modal Component
// ----------------------------------------------------------------------------
function DecisionModal({ isOpen, type, invoiceNumber, onClose, onConfirm, busy }) {
  const [comment, setComment] = useState('');
  if (!isOpen) return null;

  const isApprove = type === 'approve';
  const defaultComment = isApprove
    ? 'Approved with business justification and operational deviation sign-off.'
    : 'Rejected due to discrepancy in goods received versus invoiced quantity/price.';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>{isApprove ? 'Approve Invoice' : 'Reject Invoice'}</h3>
        <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 12px' }}>
          Invoice <b>{invoiceNumber}</b>. Record reviewer justification for audit compliance.
        </p>
        <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--ink)' }}>
          Reviewer Comment / Reason:
          <textarea
            value={comment || defaultComment}
            onChange={e => setComment(e.target.value)}
            rows={3}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={isApprove ? '' : 'danger'}
            onClick={() => onConfirm(comment || defaultComment)}
            disabled={busy}
          >
            {busy ? 'Saving…' : isApprove ? 'Confirm Approval' : 'Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Return Excess Received Items Modal (RTV - Return to Vendor)
// ----------------------------------------------------------------------------
function ReturnExcessModal({
  isOpen,
  poNumber,
  initialItemName,
  initialExcessQty,
  invoiceId,
  onClose,
  onReturned,
  user
}) {
  const [itemName, setItemName] = useState(initialItemName || '');
  const [quantity, setQuantity] = useState(initialExcessQty || 1);
  const [reason, setReason] = useState('Excess shipment over authorized PO quantity (Return to Vendor - RTV)');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState(null);

  useEffect(() => {
    if (initialItemName) setItemName(initialItemName);
    if (initialExcessQty) setQuantity(initialExcessQty);
    setError('');
    setSuccessData(null);
  }, [isOpen, initialItemName, initialExcessQty]);

  if (!isOpen) return null;

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const url = invoiceId
        ? `/invoices/${invoiceId}/return-excess`
        : `/purchase-orders/${encodeURIComponent(poNumber)}/return-excess`;
      const res = await api.post(url, {
        itemName,
        quantity: Number(quantity),
        reason,
        notes,
        reviewer: user?.name || 'Warehouse / Finance Reviewer'
      });
      setSuccessData(res.data);
      if (onReturned) onReturned(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDone = () => {
    setSuccessData(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
        {successData ? (
          <div>
            <div style={{ textAlign: 'center', padding: '16px 0 20px' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: '#dcfce7',
                  color: '#15803d',
                  fontSize: '28px',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 12px'
                }}
              >
                ✓
              </div>
              <h3 style={{ margin: '0 0 6px', color: '#166534' }}>Goods Return to Vendor (RTV) Logged!</h3>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
                Excess shipment officially returned and deducted from warehouse accepted inventory.
              </p>
            </div>

            <div
              style={{
                background: '#f8faf9',
                border: '1px solid var(--line)',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '18px'
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Official RTV Note #</small>
                  <strong style={{ fontFamily: 'monospace', color: '#b91c1c', fontSize: '15px' }}>
                    {successData.returnNumber}
                  </strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Target PO #</small>
                  <strong>{successData.poNumber}</strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Returned Quantity</small>
                  <strong style={{ color: '#b91c1c' }}>{successData.quantityReturned} units</strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Net Accepted Inventory</small>
                  <strong style={{ color: '#15803d' }}>{successData.netAcceptedQuantity} units</strong>
                </div>
              </div>

              {successData.reconciliation && (
                <div
                  style={{
                    marginTop: '14px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#166534', fontWeight: 600 }}>
                    ⚡ 3-Way Reconciliation Outcome:
                  </span>
                  <span className="badge three-way-matched" style={{ fontSize: '11px', padding: '4px 8px' }}>
                    ✓ 3-WAY MATCHED
                  </span>
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={handleDone} style={{ minWidth: '160px' }}>
                Close & Refresh
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="modal-card-header">
              <div>
                <h3 style={{ margin: 0 }}>Return Excess Items to Vendor (RTV)</h3>
                <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '4px 0 0' }}>
                  Log an official Return-to-Vendor note for surplus or over-delivered units against PO <b>{poNumber}</b>.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={onClose}>
                ×
              </button>
            </div>

            {error && (
              <div
                style={{
                  background: '#fff0ef',
                  color: '#a53b33',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '14px',
                  fontSize: '12px'
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gap: '14px', marginBottom: '18px' }}>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Target Purchase Order:
                  <input
                    type="text"
                    readOnly
                    value={poNumber}
                    style={{
                      padding: '9px',
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      background: '#f8faf9',
                      fontWeight: 700
                    }}
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                    Item Description:
                    <input
                      type="text"
                      required
                      value={itemName}
                      onChange={e => setItemName(e.target.value)}
                      placeholder="Item name matching PO"
                      style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                    Return Quantity:
                    <input
                      type="number"
                      required
                      min="1"
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      style={{
                        padding: '9px',
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                        fontWeight: 700
                      }}
                    />
                  </label>
                </div>

                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Reason for Return (RTV):
                  <select
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                  >
                    <option value="Excess shipment over authorized PO quantity (Return to Vendor - RTV)">
                      Excess shipment over authorized PO quantity (Surplus)
                    </option>
                    <option value="Damaged / Defective units identified during dock inspection">
                      Damaged / Defective units identified during dock inspection
                    </option>
                    <option value="Incorrect item specification received from vendor">
                      Incorrect item specification received from vendor
                    </option>
                    <option value="Contractual order deviation - Vendor over-dispatch">
                      Contractual order deviation - Vendor over-dispatch
                    </option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Carrier & Dispatch Notes:
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Sent back with carrier on Truck #TRK-991, gate pass #GP-402, vendor acknowledged RMA."
                    style={{
                      padding: '9px',
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      resize: 'vertical'
                    }}
                  />
                </label>
              </div>

              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '18px',
                  fontSize: '12px',
                  color: '#92400e'
                }}
              >
                ℹ️ <b>Automated 3-Way Reconciliation Sync:</b> Submitting this RTV note will generate an official
                Return Note (RTV-xxxx), deduct the excess quantity from the warehouse GRN, synchronize the
                invoice, and automatically re-reconcile the order to <b>3-WAY MATCHED</b>.
              </div>

              <div className="modal-actions">
                <button type="button" className="outline" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-rtv" disabled={busy}>
                  {busy ? 'Processing Return & Re-matching…' : `↩ Confirm & Return ${quantity} Units to Vendor`}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Application Shell
// ----------------------------------------------------------------------------
function Shell({ children, user, onSignOut, aiInfo, onResetData, isResetting, onSwitchRole }) {
  const [isChatOpen, setIsChatOpen] = useState(true);

  // Automatically open the chat as per the role or who logged in
  useEffect(() => {
    setIsChatOpen(true);
  }, [user?.role, user?.id, user?.email]);

  const role = user?.role || 'ADMIN';
  const visibleNav = ALL_NAV.filter(([_, __, roles]) => !roles || roles.includes(role));
  const isAdmin = role === 'ADMIN';

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span>AI</span> Reconcile
        </div>
        <p className="caption">FINANCE OPERATIONS</p>

        <div className="workspace">
          <div>
            <span className={`pulse ${aiInfo?.aiStatus?.active ? 'pulse-live' : ''}`} />
            <b style={{ fontSize: '11px', color: '#fff' }}>
              {aiInfo?.aiStatus?.active ? 'Live AI Engine' : 'Demo Engine'}
            </b>
          </div>
          <small style={{ fontSize: '9px', opacity: 0.8, color: '#caed5f' }}>
            {aiInfo?.aiStatus?.active ? 'Groq Active' : 'Fallback'}
          </small>
        </div>

        <div style={{ margin: '0 8px 14px', padding: '9px 11px', borderRadius: '7px', background: '#122e26', border: '1px solid #1a4539' }}>
          <div style={{ fontSize: '10px', color: '#8fa79e', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Active Role</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <b style={{ color: '#fff', fontSize: '12px' }}>{user?.name || 'User'}</b>
            <span className={`role-tag ${getRoleTagClass(role)}`}>
              {getRoleLabel(role)}
            </span>
          </div>
        </div>

        <nav>
          {visibleNav.map(([to, label]) => (
            <NavLink key={to} end={to === '/'} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="side-footer">
          {isAdmin ? (
            <button
              type="button"
              className="reset-btn"
              style={{ width: '100%', marginBottom: '10px' }}
              onClick={onResetData}
              disabled={isResetting}
            >
              {isResetting ? 'Resetting DB…' : '↺ Reset Test Data'}
            </button>
          ) : (
            <div style={{ marginBottom: '8px', fontSize: '11px', color: '#8fa79e' }}>
              Logged in: <b>{user?.name}</b>
            </div>
          )}
          <p>Model: {aiInfo?.activeModel?.split('/')[1] || 'gpt-oss-120b'}</p>
          <small>Status: Live 3-Way Reconcile</small>
        </div>
      </aside>

      <main className={isChatOpen ? 'with-chat-panel' : ''}>
        <header>
          <div>
            <p className="eyebrow">
              AUTONOMOUS 3-WAY MATCHING · {aiInfo?.aiStatus?.active ? 'LIVE GROQ LPU' : 'DEMO MODE'}
            </p>
            <h2>Invoice Control Center</h2>
          </div>
          <div className="header-actions">
            {/* Direct Right-Side AI Copilot Toggle Button */}
            <button
              type="button"
              className="btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: isChatOpen ? '#ddf3e9' : 'var(--green)',
                color: isChatOpen ? '#0d6a53' : '#ffffff',
                border: isChatOpen ? '1px solid #b7e3cf' : 'none',
                fontWeight: 700,
                cursor: 'pointer'
              }}
              onClick={() => setIsChatOpen(!isChatOpen)}
              title={isChatOpen ? 'Minimize right-side AI Copilot' : 'Open AI Copilot panel on right side'}
            >
              <span>🤖</span>
              <span>{isChatOpen ? 'Copilot Open' : 'Open AI Copilot'}</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                className="reset-btn"
                onClick={onResetData}
                disabled={isResetting}
                title="Reset all seed invoices back to UPLOADED state for demo testing"
              >
                {isResetting ? 'Resetting…' : '↺ Reset Data'}
              </button>
            )}
            <div className="user">
              <span className="avatar">
                {user?.name
                  ? user.name
                      .split(' ')
                      .map(x => x[0])
                      .join('')
                      .slice(0, 2)
                  : 'AD'}
              </span>
              <div>
                <b>{user?.name || 'User'}</b>
                <div style={{ marginTop: '2px' }}>
                  <span className={`role-tag ${getRoleTagClass(role)}`}>
                    {getRoleLabel(role)}
                  </span>
                </div>
              </div>
            </div>
            <button type="button" className="signout" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>
        {children}
      </main>

      {/* Persistent Docked Right-Side Chatbot with Isolated User State */}
      <ChatBotPanel
        key={user?.id ? `user-${user.id}` : user?.email || 'guest'}
        user={user}
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen(!isChatOpen)}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Dashboard Component
// ----------------------------------------------------------------------------
function Dashboard({ aiInfo, user }) {
  const [s, setS] = useState({});
  const nav = useNavigate();
  const role = user?.role || 'ADMIN';

  useEffect(() => {
    const loadStats = () => api.get('/dashboard/stats').then(x => setS(x.data));
    loadStats();
    window.addEventListener('erp-data-updated', loadStats);
    return () => window.removeEventListener('erp-data-updated', loadStats);
  }, []);

  const metrics = [
    ['Total Invoices', s.total || 0, 'total'],
    ['Needs Processing', s.uploaded || 0, 'uploaded'],
    ['3-Way Matched', s.matched || 0, 'matched'],
    ['Discrepancies / Review', s.pending_approval || 0, 'pending-review'],
    ['Approved by Reviewer', s.approved || 0, 'approved'],
    ['Rejected Invoices', s.rejected || 0, 'rejected']
  ];

  return (
    <>
      <Title
        title="Operations Overview"
        text="Real-time multi-agent invoice matching, split GRN aggregation, and exception intelligence."
      />

      {/* Role Banner */}
      {role === 'ADMIN' && (
        <div className="role-permission-banner" style={{ background: '#f6fdf2', borderColor: '#caed5f' }}>
          <div>
            <b>👑 Admin Console ({user?.name}):</b> Full administrative privilege across all modules: Purchase Orders, Invoices, Inbound Deliveries, Approval Queue, and Batch Operations.
          </div>
          <span className="role-tag role-tag-admin">Full System Access</span>
        </div>
      )}

      {role === 'PURCHASER' && (
        <div className="role-permission-banner" style={{ background: '#f0f7ff', borderColor: '#bfdbfe' }}>
          <div>
            <b>🛒 Procurement Workspace ({user?.name}):</b> Create Purchase Orders, upload vendor bills, and track delivery progress against ordered quantities.
          </div>
          <span className="role-tag role-tag-purchaser">Procurement & Bills</span>
        </div>
      )}

      {role === 'WAREHOUSE' && (
        <div className="role-permission-banner" style={{ background: '#fff9f0', borderColor: '#fed7aa' }}>
          <div>
            <b>📦 Warehouse Operations ({user?.name}):</b> Inspect shipments at the dock, record accepted delivered quantities, and generate AI Goods Receipt Notes (GRNs).
          </div>
          <span className="role-tag role-tag-warehouse">Dock & Deliveries</span>
        </div>
      )}

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {metrics.map(([label, val, cls]) => (
          <section className="metric" key={label}>
            <small>{label}</small>
            <strong style={{ color: cls === 'matched' ? '#17683d' : cls === 'pending-review' ? '#8a5a00' : 'inherit' }}>
              {val}
            </strong>
          </section>
        ))}
      </div>

      <div className="two">
        <section className="card">
          <h3>Live AI Engine Architecture</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <small style={{ color: 'var(--muted)', display: 'block' }}>Active AI Model</small>
              <b style={{ color: 'var(--green)' }}>{aiInfo?.activeModel || 'openai/gpt-oss-120b'}</b>
            </div>
            <div>
              <small style={{ color: 'var(--muted)', display: 'block' }}>Provider Mode</small>
              <b>{aiInfo?.aiStatus?.active ? 'Groq LPU Acceleration' : 'Fallback / Demo'}</b>
            </div>
            <div>
              <small style={{ color: 'var(--muted)', display: 'block' }}>Database</small>
              <b>MySQL 8 (Local Pool)</b>
            </div>
            <div>
              <small style={{ color: 'var(--muted)', display: 'block' }}>AI Status</small>
              <span className="badge matched">ONLINE & VERIFIED</span>
            </div>
          </div>
          <p className="note">
            The system combines deterministic arithmetic checks for PO/GRN matching with high-speed Groq LLM inference for
            data extraction, anomaly detection, and root-cause exception analysis.
          </p>
        </section>

        <section className="card">
          <h3>Quick Actions ({getRoleLabel(role)})</h3>
          <div style={{ display: 'grid', gap: '8px' }}>
            {role === 'WAREHOUSE' ? (
              <>
                <button onClick={() => nav('/deliveries')} style={{ textAlign: 'left', width: '100%' }}>
                  → Log Inbound Delivery (Record Received Goods & Generate GRN)
                </button>
                <button onClick={() => nav('/purchase-orders')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → View Inbound Purchase Orders (Check Expected Quantities)
                </button>
                <button onClick={() => nav('/deliveries')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → View Inbound Fulfillment Scorecards
                </button>
              </>
            ) : role === 'PURCHASER' ? (
              <>
                <button onClick={() => nav('/purchase-orders')} style={{ textAlign: 'left', width: '100%' }}>
                  → Create New Purchase Order (+ Add Line Items)
                </button>
                <button onClick={() => nav('/deliveries')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Track PO Inbound Deliveries & GRNs
                </button>
                <button onClick={() => nav('/upload')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Upload Vendor Invoice / Bill
                </button>
                <button onClick={() => nav('/invoices')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → View Invoices & 3-Way Match Status
                </button>
              </>
            ) : (
              <>
                <button onClick={() => nav('/invoices')} style={{ textAlign: 'left', width: '100%' }}>
                  → View and Process Invoices (Test Matched & Mismatched)
                </button>
                <button onClick={() => nav('/purchase-orders')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Manage Purchase Orders & Track Deliveries
                </button>
                <button onClick={() => nav('/deliveries')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Log Inbound Shipments & Inspect GRNs
                </button>
                <button onClick={() => nav('/exceptions')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Open Approval Queue ({s.pending_approval || 0} pending review)
                </button>
                <button onClick={() => nav('/upload')} className="secondary" style={{ textAlign: 'left', width: '100%' }}>
                  → Upload Single Invoice / Bulk Import
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <h3>5-Stage Multi-Agent Reconciliation Pipeline</h3>
        <div className="flow">
          <b>1. Invoice Agent</b>
          <i>→</i>
          <b>2. PO Agent</b>
          <i>→</i>
          <b>3. Delivery & GRN Agent</b>
          <i>→</i>
          <b>4. Reconciliation Engine</b>
          <i>→</i>
          <b>5. Exception Agent</b>
          <i>→</i>
          <b>6. Approval Queue</b>
        </div>
        <p className="note" style={{ marginTop: '12px' }}>
          • <b>Invoice Agent:</b> Analyzes invoice payload, verifies line total math and tax calculations.
          <br />
          • <b>PO & GRN Agents:</b> Queries ERP records and aggregates multi-delivery split GRNs (e.g. DEL-001 75 units + DEL-002 25 units = 100 received).
          <br />
          • <b>Reconciliation Engine:</b> Authoritative item-by-item quantity, unit price, and grand total matching.
          <br />
          • <b>Exception Agent:</b> Uses Groq AI to generate business root-cause diagnoses, quantify financial exposure, and suggest resolution actions.
        </p>
      </section>
    </>
  );
}

// ----------------------------------------------------------------------------
// Invoice List Component (with Search TC-07)
// ----------------------------------------------------------------------------
function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    api
      .get('/invoices', { params: { search, status: statusFilter } })
      .then(res => setInvoices(res.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const handleRefresh = () => load();
    window.addEventListener('erp-data-updated', handleRefresh);
    return () => window.removeEventListener('erp-data-updated', handleRefresh);
  }, [search, statusFilter]);

  const processAll = async () => {
    const unproc = invoices.filter(i => i.status === 'UPLOADED');
    if (!unproc.length) {
      alert('No unprocessed invoices in current view.');
      return;
    }
    setLoading(true);
    for (const inv of unproc) {
      try {
        await api.post(`/invoices/${inv.id}/process`);
      } catch (err) {
        console.error(err);
      }
    }
    load();
  };

  const filters = ['ALL', 'UPLOADED', 'MATCHED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'];

  return (
    <>
      <Title
        title="Invoices"
        text="Manage and review invoices across all suppliers and purchase orders."
        action={
          <button onClick={processAll} disabled={loading}>
            {loading ? 'Processing…' : '⚡ Process All Unprocessed'}
          </button>
        }
      />

      <div className="search-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search by invoice number (e.g. INV-1001), PO number, or vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-pills">
          {filters.map(f => (
            <button
              key={f}
              type="button"
              className={`filter-pill ${statusFilter === f ? 'active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <Table
        cols={['Invoice #', 'Vendor', 'PO #', 'Items', 'Total Amount', 'Status', 'Actions']}
        rows={invoices.map(x => [
          <b>{x.invoice_number}</b>,
          x.vendor,
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>{x.po_number}</span>,
          x.item_count || 1,
          money(x.total_amount),
          <Status>{x.status}</Status>,
          <NavLink className="link" to={`/invoices/${x.id}`}>
            Open Detail →
          </NavLink>
        ])}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Invoice Detail Component (TC-02, TC-03, TC-04, TC-05)
// ----------------------------------------------------------------------------
function InvoiceDetail({ user }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalState, setModalState] = useState({ open: false, type: 'approve' });
  const [returnModal, setReturnModal] = useState({ open: false, itemName: '', excessQty: 0 });
  const [openJsonAgent, setOpenJsonAgent] = useState(null);

  const load = () => api.get(`/invoices/${id}`).then(res => setData(res.data));

  useEffect(() => {
    load();
  }, [id]);

  if (!data) return <p style={{ padding: '40px', color: 'var(--muted)' }}>Loading invoice details…</p>;

  const runAgents = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/process`);
      await load();
    } catch (err) {
      alert(`Error processing invoice: ${err.response?.data?.error || err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async comment => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/${modalState.type}`, {
        reviewer: user?.name || 'Alex Admin',
        comment
      });
      setModalState({ open: false, type: 'approve' });
      await load();
    } catch (err) {
      alert(`Decision error: ${err.response?.data?.error || err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const r = data.reconciliation;
  const po = data.po;
  const exc = data.exception;
  const canApprove = user?.role === 'ADMIN' || user?.role === 'REVIEWER';

  const hasExcessItems =
    r?.matchClassification === 'MORE_RECEIVED' ||
    r?.itemComparisons?.some(c => c.status === 'MORE_RECEIVED' || (c.excessQuantity && c.excessQuantity > 0)) ||
    (po && (po.total_accepted_quantity || 0) > (po.total_ordered_quantity || 0));

  const excessItemObj =
    r?.itemComparisons?.find(c => c.status === 'MORE_RECEIVED' || (c.excessQuantity && c.excessQuantity > 0)) ||
    (po?.items?.[0]
      ? {
          itemName: po.items[0].item_name,
          excessQuantity: Math.max(0, (po.total_accepted_quantity || 0) - (po.total_ordered_quantity || 0))
        }
      : null);

  return (
    <>
      <Title
        title={`Invoice ${data.invoice_number}`}
        text={`${data.vendor} · PO: ${data.po_number}`}
        action={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {data.status !== 'BLOCKED' && (
              <button onClick={runAgents} disabled={busy}>
                {busy ? 'Running Agents…' : r ? '↺ Re-run AI Agents' : '⚡ Run AI Agents'}
              </button>
            )}
            {hasExcessItems && (
              <button
                type="button"
                className="btn-rtv"
                onClick={() =>
                  setReturnModal({
                    open: true,
                    itemName: excessItemObj?.itemName || data.items?.[0]?.item_name,
                    excessQty: excessItemObj?.excessQuantity || 1
                  })
                }
              >
                ↩ Return Excess Items (RTV)
              </button>
            )}
            {data.status === 'BLOCKED' && (
              <span className="badge blocked" style={{ fontSize: '13px', padding: '7px 14px' }}>
                🔒 Locked (Pending Deliveries)
              </span>
            )}
            {data.status === 'PENDING_REVIEW' && canApprove && (
              <>
                <button
                  type="button"
                  style={{ background: '#16804e' }}
                  onClick={() => setModalState({ open: true, type: 'approve' })}
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setModalState({ open: true, type: 'reject' })}
                >
                  ✕ Reject
                </button>
              </>
            )}
            {data.status === 'MATCHED' && canApprove && (
              <button
                type="button"
                style={{ background: '#16804e' }}
                onClick={() => setModalState({ open: true, type: 'approve' })}
              >
                ✓ Sign Off & Complete (Approve)
              </button>
            )}
            {data.status === 'APPROVED' && (
              <span className="badge approved" style={{ fontSize: '13px', padding: '7px 14px' }}>
                ✓ Completed & Saved (Approved)
              </span>
            )}
            {data.status === 'REJECTED' && (
              <span className="badge rejected" style={{ fontSize: '13px', padding: '7px 14px' }}>
                ✕ Rejected & Voided
              </span>
            )}
          </div>
        }
      />

      {data.status === 'BLOCKED' && (
        <div className="blocked-banner">
          <div>
            <b style={{ color: '#1e293b', fontSize: '14px' }}>
              🔒 Invoice Access Blocked / Payment Locked: Awaiting Warehouse Deliveries
            </b>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#475569' }}>
              This invoice was pre-generated upon PO creation and remains locked from payment disbursement and
              reviewer signoff until physical shipments are recorded at the warehouse dock. Once deliveries
              arrive, 3-way matching will execute automatically.
            </p>
          </div>
          <span className="badge blocked" style={{ fontSize: '11px', padding: '5px 12px' }}>
            STATUS: BLOCKED
          </span>
        </div>
      )}

      {data.status === 'APPROVED' && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '12px 18px',
            marginBottom: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <b style={{ color: '#15803d', fontSize: '14px' }}>✓ Invoice Approved, Completed and Saved</b>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#166534' }}>
              Formally approved by {data.approvals?.[0]?.reviewer || user?.name || 'Reviewer'}. All records locked and authorized for disbursement.
            </p>
          </div>
          <span className="role-tag role-tag-admin" style={{ fontSize: '11px', padding: '4px 10px' }}>
            STATUS: APPROVED
          </span>
        </div>
      )}

      {/* Overview 3-Way Comparison Cards */}
      <div className="three" style={{ marginBottom: '20px' }}>
        {/* 1. Invoice Card */}
        <section className="card" style={{ margin: 0 }}>
          <h3>1. Invoice Data</h3>
          <dl>
            <dt>Vendor</dt>
            <dd>{data.vendor}</dd>
            <dt>Invoice Date</dt>
            <dd>{new Date(data.invoice_date).toLocaleDateString()}</dd>
            <dt>Subtotal</dt>
            <dd>{money(Number(data.total_amount) - Number(data.tax_amount))}</dd>
            <dt>Tax Amount</dt>
            <dd>{money(data.tax_amount)}</dd>
            <dt>Grand Total</dt>
            <dd style={{ color: 'var(--green)' }}>{money(data.total_amount)}</dd>
            <dt>Status</dt>
            <dd>
              <Status>{data.status}</Status>
            </dd>
          </dl>
          <div style={{ marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
            <small style={{ color: 'var(--muted)', fontWeight: 'bold' }}>INVOICED LINE ITEMS</small>
            {data.items.map(it => (
              <div
                key={it.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  marginTop: '4px'
                }}
              >
                <span>
                  {it.item_name} × <b>{Number(it.quantity)}</b>
                </span>
                <span>{money(it.line_total)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Purchase Order Card */}
        <section className="card" style={{ margin: 0 }}>
          <h3>2. Purchase Order ({data.po_number})</h3>
          {po ? (
            <>
              <dl>
                <dt>PO Status</dt>
                <dd>
                  <Status>{po.status}</Status>
                </dd>
                <dt>Order Date</dt>
                <dd>{new Date(po.order_date).toLocaleDateString()}</dd>
                <dt>PO Total</dt>
                <dd style={{ color: 'var(--green)' }}>{money(po.total_amount)}</dd>
              </dl>
              <div style={{ marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                <small style={{ color: 'var(--muted)', fontWeight: 'bold' }}>ORDERED LINE ITEMS</small>
                {po.items.map(it => (
                  <div
                    key={it.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      marginTop: '4px'
                    }}
                  >
                    <span>
                      {it.item_name} × <b>{Number(it.ordered_quantity)}</b>
                    </span>
                    <span>{money(Number(it.ordered_quantity) * Number(it.unit_price))}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--muted)' }}>No PO records found.</p>
          )}
        </section>

        {/* 3. Deliveries & Split GRNs Card (TC-05) */}
        <section className="card" style={{ margin: 0 }}>
          <h3>3. Split Deliveries & GRNs</h3>
          {po?.deliveries?.length ? (
            <div>
              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 10px' }}>
                Deliveries are tracked individually; accepted quantities are aggregated for 3-way matching.
              </p>
              {po.deliveries.map(del => {
                const linkedGrns = po.grns.filter(g => g.delivery_id === del.id);
                return (
                  <div
                    key={del.id}
                    style={{
                      background: 'var(--paper)',
                      padding: '10px',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span>{del.delivery_number}</span>
                      <small style={{ color: 'var(--muted)' }}>
                        {new Date(del.delivery_date).toLocaleDateString()}
                      </small>
                    </div>
                    {linkedGrns.map((g, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: '11px',
                          marginTop: '4px',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}
                      >
                        <span style={{ color: 'var(--green)' }}>GRN: {g.grn_number}</span>
                        <span>
                          {g.item_name}: <b>{Number(g.accepted_quantity)} units</b>
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ color: 'var(--muted)' }}>No goods receipt records found for this PO.</p>
          )}
        </section>
      </div>

      {/* 3-Way Matching Result & Discrepancies */}
      {r ? (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Authoritative Three-Way Reconciliation Result</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {r.matchClassification === 'LESS_RECEIVED' && (
                <span className="badge less-received">LESS RECEIVED</span>
              )}
              {r.matchClassification === 'MORE_RECEIVED' && (
                <span className="badge more-received">MORE RECEIVED</span>
              )}
              {r.matchClassification === 'MATCHED' && (
                <span className="badge matched">3-WAY MATCHED</span>
              )}
              <Status>{r.status}</Status>
              <span className="split-badge">AI Mode: {r.aiMode || 'GROQ'}</span>
            </div>
          </div>

          {hasExcessItems && (
            <div className="rtv-banner">
              <div>
                <b style={{ color: '#92400e', fontSize: '13px' }}>⚠️ Inbound Over-Delivery: Surplus Units Received</b>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#b45309' }}>
                  Warehouse has accepted {excessItemObj?.excessQuantity ? `${excessItemObj.excessQuantity} surplus units` : 'surplus units'} beyond authorized PO contract. Return excess goods to vendor to achieve 3-way match.
                </p>
              </div>
              <button
                type="button"
                className="btn-rtv btn-sm"
                onClick={() =>
                  setReturnModal({
                    open: true,
                    itemName: excessItemObj?.itemName || data.items?.[0]?.item_name,
                    excessQty: excessItemObj?.excessQuantity || 1
                  })
                }
              >
                ↩ Return Excess to Vendor (RTV)
              </button>
            </div>
          )}

          {/* Item Comparison Table */}
          {r.itemComparisons?.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Invoiced Qty</th>
                    <th>Ordered Qty</th>
                    <th>Received GRN Qty</th>
                    <th>Qty Variance</th>
                    <th>Invoiced Price</th>
                    <th>PO Price</th>
                    <th>Match Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.itemComparisons.map((c, i) => (
                    <tr key={i}>
                      <td><b>{c.itemName}</b></td>
                      <td>{c.invoiceQuantity}</td>
                      <td>{c.poQuantity}</td>
                      <td>{c.receivedQuantity}</td>
                      <td style={{ color: c.quantityDifference !== 0 ? '#a1362d' : 'inherit', fontWeight: 'bold' }}>
                        {c.quantityDifference > 0 ? `+${c.quantityDifference}` : c.quantityDifference}
                      </td>
                      <td>{money(c.invoiceUnitPrice)}</td>
                      <td>{money(c.poUnitPrice)}</td>
                      <td>
                        {c.status === 'LESS_RECEIVED' ? (
                          <span className="badge less-received">LESS RECEIVED (SHORT)</span>
                        ) : c.status === 'MORE_RECEIVED' ? (
                          <span className="badge more-received">MORE RECEIVED (OVER)</span>
                        ) : c.status === 'MATCHED' ? (
                          <span className="badge matched">✓ MATCHED</span>
                        ) : (
                          <Status>{c.status}</Status>
                        )}
                        {c.note && (
                          <small style={{ display: 'block', fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                            {c.note}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Executive AI Statement */}
          {r.aiSummary && (
            <div
              style={{
                background: r.status === 'MATCHED' ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${r.status === 'MATCHED' ? '#bbf7d0' : '#fde68a'}`,
                padding: '16px',
                borderRadius: '8px',
                marginTop: '12px'
              }}
            >
              <b style={{ color: r.status === 'MATCHED' ? '#166534' : '#92400e', fontSize: '13px' }}>
                Executive Reconciliation Assessment:
              </b>
              <p style={{ margin: '6px 0', fontSize: '13px', lineHeight: 1.5 }}>
                {r.aiSummary.executiveSummary}
              </p>
              {r.aiSummary.financialVarianceAssessment && (
                <small style={{ color: 'var(--muted)', fontWeight: 'bold' }}>
                  {r.aiSummary.financialVarianceAssessment}
                </small>
              )}
            </div>
          )}

          {/* Exception Card if Mismatched */}
          {exc && (
            <div className="issue" style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b>AI Exception Diagnosis ({exc.exception_type.replace(/_/g, ' ')})</b>
                <Status>{exc.severity}</Status>
              </div>
              <p style={{ margin: '8px 0', whiteSpace: 'pre-line' }}>{exc.explanation}</p>
              <p className="note" style={{ margin: 0 }}>
                <b>Recommended Next Action:</b> {exc.recommended_action}
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="card" style={{ textAlign: 'center', padding: '36px' }}>
          <p style={{ fontSize: '16px', color: 'var(--muted)', margin: '0 0 16px' }}>
            This invoice has not yet undergone 3-way automated matching.
          </p>
          <button onClick={runAgents} disabled={busy}>
            {busy ? 'Running Agents…' : '⚡ Run Multi-Agent Reconciliation Pipeline'}
          </button>
        </section>
      )}

      {/* Agent Activity Timeline */}
      {data.agentLogs?.length > 0 && (
        <section className="card">
          <h3>Agent Execution Pipeline Log</h3>
          <div style={{ marginTop: '16px' }}>
            {data.agentLogs.map(l => {
              const isOpen = openJsonAgent === l.id;
              return (
                <div className="agent-step" key={l.id}>
                  <div className="agent-header">
                    <div>
                      <b>{l.agent_name}</b>
                      <small style={{ color: 'var(--muted)', marginLeft: '10px' }}>
                        {new Date(l.completed_at || l.started_at).toLocaleTimeString()}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Status>{l.status}</Status>
                      <button
                        type="button"
                        className="outline"
                        style={{ fontSize: '10px', padding: '4px 8px', margin: 0 }}
                        onClick={() => setOpenJsonAgent(isOpen ? null : l.id)}
                      >
                        {isOpen ? 'Hide Payload' : 'View Payload'}
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <pre className="agent-raw-json">
                      {JSON.stringify(l.result, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Approvals History */}
      {data.approvals?.length > 0 && (
        <section className="card">
          <h3>Reviewer Decisions</h3>
          <Table
            cols={['Decided At', 'Reviewer', 'Decision', 'Comment']}
            rows={data.approvals.map(a => [
              new Date(a.decided_at).toLocaleString(),
              a.reviewer,
              <Status>{a.decision}</Status>,
              a.comment
            ])}
          />
        </section>
      )}

      {/* Official RTV Returns */}
      {po?.returns?.length > 0 && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#991b1b' }}>↩ Official Goods Returns to Vendor (RTV Notes)</h3>
            <span className="badge returned">
              {po.returns.length} {po.returns.length === 1 ? 'Return Note' : 'Return Notes'} Logged
            </span>
          </div>
          <Table
            cols={['Return #', 'Date', 'Item', 'Quantity Returned', 'Reason', 'Status']}
            rows={po.returns.map(ret => [
              <b key="rn" style={{ fontFamily: 'monospace', color: '#b91c1c' }}>{ret.return_number}</b>,
              new Date(ret.return_date).toLocaleDateString(),
              ret.item_name,
              <b key="qty" style={{ color: '#b91c1c' }}>-{Number(ret.quantity)} units</b>,
              ret.reason,
              <span key="st" className="badge returned">RETURNED</span>
            ])}
          />
        </section>
      )}

      {/* Approval / Rejection Modal */}
      <DecisionModal
        isOpen={modalState.open}
        type={modalState.type}
        invoiceNumber={data.invoice_number}
        onClose={() => setModalState({ open: false, type: 'approve' })}
        onConfirm={handleDecision}
        busy={busy}
      />

      {/* Return Excess Modal */}
      <ReturnExcessModal
        isOpen={returnModal.open}
        poNumber={data.po_number}
        invoiceId={data.id}
        initialItemName={returnModal.itemName}
        initialExcessQty={returnModal.excessQty}
        user={user}
        onClose={() => setReturnModal({ open: false, itemName: '', excessQty: 0 })}
        onReturned={async () => {
          await load();
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Exceptions & Approval Queue Component (TC-04)
// ----------------------------------------------------------------------------
function Exceptions({ user }) {
  const [exceptions, setExceptions] = useState([]);
  const [modalState, setModalState] = useState({ open: false, type: 'approve', invoiceId: null, invoiceNumber: '' });
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/exceptions').then(res => setExceptions(res.data));

  useEffect(() => {
    load();
  }, []);

  const handleDecision = async comment => {
    setBusy(true);
    try {
      await api.post(`/invoices/${modalState.invoiceId}/${modalState.type}`, {
        reviewer: user?.name || 'Alex Admin',
        comment
      });
      setModalState({ open: false, type: 'approve', invoiceId: null, invoiceNumber: '' });
      load();
    } catch (err) {
      alert(`Error saving decision: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title
        title="Exception Review & Approval Queue"
        text="Invoices flagged with quantity over-billing, price variance, or missing documents require human review."
      />

      {exceptions.length ? (
        exceptions.map(x => (
          <section className="card exception" key={x.id}>
            <div style={{ flex: 1, paddingRight: '20px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                <Status>{x.severity}</Status>
                <b style={{ fontSize: '15px' }}>{x.exception_type.replace(/_/g, ' ')}</b>
              </div>
              <p style={{ margin: '4px 0', fontSize: '13px' }}>
                <NavLink to={`/invoices/${x.invoice_id}`} className="link">
                  {x.invoice_number}
                </NavLink>{' '}
                · Vendor: <b>{x.vendor}</b> · PO: <b>{x.po_number}</b> · Total: {money(x.total_amount)}
              </p>
              <p style={{ margin: '8px 0', whiteSpace: 'pre-line', fontSize: '13px' }}>{x.explanation}</p>
              <p className="note" style={{ margin: 0 }}>
                <b>AI Recommendation:</b> {x.recommended_action}
              </p>
            </div>
            <div className="actions" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                type="button"
                onClick={() =>
                  setModalState({
                    open: true,
                    type: 'approve',
                    invoiceId: x.invoice_id,
                    invoiceNumber: x.invoice_number
                  })
                }
              >
                Approve Invoice
              </button>
              <button
                type="button"
                className="danger"
                style={{ marginLeft: 0 }}
                onClick={() =>
                  setModalState({
                    open: true,
                    type: 'reject',
                    invoiceId: x.invoice_id,
                    invoiceNumber: x.invoice_number
                  })
                }
              >
                Reject Invoice
              </button>
            </div>
          </section>
        ))
      ) : (
        <section className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--green)', fontSize: '16px', fontWeight: 'bold' }}>
            ✓ Approval queue clear
          </p>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            All processed invoices have been reconciled or reviewed.
          </p>
        </section>
      )}

      <DecisionModal
        isOpen={modalState.open}
        type={modalState.type}
        invoiceNumber={modalState.invoiceNumber}
        onClose={() => setModalState({ open: false, type: 'approve', invoiceId: null, invoiceNumber: '' })}
        onConfirm={handleDecision}
        busy={busy}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Upload & Bulk Import Component (TC-06)
// ----------------------------------------------------------------------------
function Upload({ bulk = false }) {
  const nav = useNavigate();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    vendor: 'ABC Supplies',
    poNumber: 'PO-1001',
    item: 'Laptop',
    quantity: 100,
    unitPrice: 50000,
    tax: 900000,
    total: 5900000,
    invoiceNo: 'INV-' + Date.now().toString().slice(-6)
  });

  const fillPreset = type => {
    if (type === 'match') {
      setF({
        vendor: 'ABC Supplies',
        poNumber: 'PO-1001',
        item: 'Laptop',
        quantity: 100,
        unitPrice: 50000,
        tax: 900000,
        total: 5900000,
        invoiceNo: 'INV-' + Date.now().toString().slice(-6)
      });
    } else if (type === 'mismatch') {
      setF({
        vendor: 'ABC Supplies',
        poNumber: 'PO-1001',
        item: 'Laptop',
        quantity: 120, // 20 units excess
        unitPrice: 50000,
        tax: 1080000,
        total: 7080000,
        invoiceNo: 'INV-' + Date.now().toString().slice(-6)
      });
    }
  };

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      if (bulk) {
        const file = e.target.file.files[0];
        if (!file) throw new Error('Please select an Excel (.xlsx/.xls) or CSV (.csv) file.');
        const form = new FormData();
        form.append('file', file);
        const res = await api.post('/invoices/bulk-upload', form);
        setMsg(`Batch completed: Processed ${res.data.processed} rows (${res.data.failed} failed). Batch # ${res.data.batchNumber}`);
      } else {
        const res = await api.post('/invoices/upload', f);
        setMsg('Invoice uploaded successfully. Redirecting to AI matching…');
        setTimeout(() => nav(`/invoices/${res.data.id}`), 500);
      }
    } catch (err) {
      setMsg(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title
        title={bulk ? 'Bulk Batch Upload' : 'Create Single Invoice'}
        text={
          bulk
            ? 'Upload Excel or CSV spreadsheets. Each row is processed independently by the agent pipeline.'
            : 'Submit a new invoice against an existing Purchase Order and verify three-way matching.'
        }
      />

      {!bulk && (
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="outline"
            style={{ fontSize: '11px', margin: 0 }}
            onClick={() => fillPreset('match')}
          >
            Fill Preset: Matched (100 Laptops / PO-1001)
          </button>
          <button
            type="button"
            className="outline"
            style={{ fontSize: '11px', margin: 0 }}
            onClick={() => fillPreset('mismatch')}
          >
            Fill Preset: Quantity Mismatch (120 Laptops / PO-1001)
          </button>
        </div>
      )}

      {bulk && (
        <div style={{ marginBottom: '16px' }}>
          <a
            href="http://localhost:5000/api/invoices/template/sample"
            download="invoice_template.csv"
            className="button outline"
            style={{ fontSize: '12px', margin: 0, display: 'inline-block' }}
          >
            ↓ Download Sample CSV Template
          </a>
        </div>
      )}

      <form className="card form" onSubmit={submit}>
        {bulk ? (
          <>
            <label style={{ gridColumn: '1 / -1' }}>
              Select Spreadsheet File (.xlsx, .xls, .csv):
              <input name="file" type="file" accept=".xlsx,.xls,.csv" required />
            </label>
            <p className="note">
              Expected headers: <code>invoiceNo, vendor, poNumber, item, quantity, unitPrice, tax, total</code>.
            </p>
          </>
        ) : (
          <>
            <label>
              Invoice Number:
              <input
                value={f.invoiceNo}
                onChange={e => setF({ ...f, invoiceNo: e.target.value })}
                required
              />
            </label>
            <label>
              Vendor Name:
              <select
                value={f.vendor}
                onChange={e => setF({ ...f, vendor: e.target.value })}
                required
              >
                <option value="ABC Supplies">ABC Supplies</option>
                <option value="XYZ Displays">XYZ Displays</option>
                <option value="TechSource India">TechSource India</option>
                <option value="Office Essentials">Office Essentials</option>
                <option value="Network Hub">Network Hub</option>
              </select>
            </label>
            <label>
              PO Number:
              <input
                value={f.poNumber}
                onChange={e => setF({ ...f, poNumber: e.target.value })}
                required
              />
            </label>
            <label>
              Item Name:
              <input
                value={f.item}
                onChange={e => setF({ ...f, item: e.target.value })}
                required
              />
            </label>
            <label>
              Quantity:
              <input
                type="number"
                value={f.quantity}
                onChange={e => {
                  const q = Number(e.target.value);
                  const sub = q * f.unitPrice;
                  const tax = sub * 0.18;
                  setF({ ...f, quantity: q, tax, total: sub + tax });
                }}
                required
              />
            </label>
            <label>
              Unit Price (INR):
              <input
                type="number"
                value={f.unitPrice}
                onChange={e => {
                  const p = Number(e.target.value);
                  const sub = f.quantity * p;
                  const tax = sub * 0.18;
                  setF({ ...f, unitPrice: p, tax, total: sub + tax });
                }}
                required
              />
            </label>
            <label>
              Tax Amount (INR):
              <input
                type="number"
                value={f.tax}
                onChange={e => setF({ ...f, tax: Number(e.target.value) })}
              />
            </label>
            <label>
              Grand Total (INR):
              <input
                type="number"
                value={f.total}
                onChange={e => setF({ ...f, total: Number(e.target.value) })}
                required
              />
            </label>
          </>
        )}

        <button disabled={busy}>
          {busy ? 'Submitting…' : bulk ? 'Upload and Run Batch' : 'Create Invoice'}
        </button>

        {msg && <p className="message">{msg}</p>}
      </form>
    </>
  );
}

// ----------------------------------------------------------------------------
// Create Purchase Order Modal
// ----------------------------------------------------------------------------
function CreatePOModal({ isOpen, onClose, onCreated }) {
  const [poNumber, setPoNumber] = useState('');
  const [vendor, setVendor] = useState('TechCorp Solutions');
  const [customVendor, setCustomVendor] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState([
    { itemName: 'Dell UltraSharp 27 Monitor', quantity: 10, unitPrice: 25000 }
  ]);
  const [vendors, setVendors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPoNumber(`PO-${Math.floor(1000 + Math.random() * 9000)}`);
      setError('');
      api.get('/vendors').then(res => {
        const raw = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        const names = raw.map(v => typeof v === 'string' ? v : v.name).filter(Boolean);
        if (names.length) {
          setVendors(names);
          setVendor(names[0]);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const addItem = () => {
    setItems([...items, { itemName: '', quantity: 1, unitPrice: 1000 }]);
  };

  const removeItem = index => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const finalVendor = vendor === '__custom__' ? customVendor.trim() : vendor;
  const totalAmount = items.reduce(
    (acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );

  const handleSubmit = async e => {
    e.preventDefault();
    if (!poNumber.trim()) {
      setError('PO Number is required.');
      return;
    }
    if (!finalVendor) {
      setError('Vendor name is required.');
      return;
    }
    for (const it of items) {
      if (!it.itemName.trim()) {
        setError('All items must have a valid item description.');
        return;
      }
      if (Number(it.quantity) <= 0 || Number(it.unitPrice) <= 0) {
        setError('Quantities and unit prices must be greater than zero.');
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      await api.post('/purchase-orders', {
        poNumber: poNumber.trim().toUpperCase(),
        vendor: finalVendor,
        orderDate,
        items: items.map(it => ({
          itemName: it.itemName.trim(),
          orderedQuantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice)
        }))
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create Purchase Order');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-card-header">
          <div>
            <h3>Create Purchase Order</h3>
            <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>
              Establish an ERP Purchase Order with line items for 3-way reconciliation and shipment tracking.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && (
          <div style={{ background: '#fff0ef', color: '#a53b33', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
              PO Number:
              <input
                type="text"
                required
                value={poNumber}
                onChange={e => setPoNumber(e.target.value.toUpperCase())}
                placeholder="e.g. PO-2001"
                style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
              Order Date:
              <input
                type="date"
                required
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
              />
            </label>

            <label style={{ gridColumn: '1 / -1', display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
              Vendor:
              <div style={{ display: 'grid', gridTemplateColumns: vendor === '__custom__' ? '1fr 1fr' : '1fr', gap: '8px' }}>
                <select
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                >
                  {vendors.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                  <option value="__custom__">+ Enter Custom Vendor...</option>
                </select>
                {vendor === '__custom__' && (
                  <input
                    type="text"
                    required
                    placeholder="Enter vendor name"
                    value={customVendor}
                    onChange={e => setCustomVendor(e.target.value)}
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                  />
                )}
              </div>
            </label>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <b style={{ fontSize: '13px' }}>Purchase Order Line Items</b>
              <button type="button" className="btn-sm btn-outline" onClick={addItem}>
                + Add Line Item
              </button>
            </div>

            <table className="item-entry-table">
              <thead>
                <tr>
                  <th style={{ width: '45%' }}>Item Description</th>
                  <th style={{ width: '18%' }}>Quantity</th>
                  <th style={{ width: '22%' }}>Unit Price (₹)</th>
                  <th style={{ width: '15%' }}>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        type="text"
                        required
                        placeholder="Item description / SKU"
                        value={it.itemName}
                        onChange={e => updateItem(idx, 'itemName', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        required
                        value={it.quantity}
                        onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        required
                        value={it.unitPrice}
                        onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                      />
                    </td>
                    <td style={{ fontWeight: 'bold' }}>
                      {money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}
                    </td>
                    <td>
                      {items.length > 1 && (
                        <button
                          type="button"
                          className="btn-sm"
                          style={{ background: '#fee2e2', color: '#b91c1c', border: 'none' }}
                          onClick={() => removeItem(idx)}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Total Line Items: <b>{items.length}</b>
            </span>
            <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
              Total Order Value: <span style={{ color: 'var(--green)' }}>{money(totalAmount)}</span>
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="outline" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Creating PO…' : 'Create Purchase Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Log Inbound Delivery Modal (with Autonomous Agent GRN Generation)
// ----------------------------------------------------------------------------
function LogDeliveryModal({ isOpen, onClose, onLogged, preselectedPoNumber = '' }) {
  const [pos, setPos] = useState([]);
  const [deliveryNumber, setDeliveryNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [vendor, setVendor] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState([{ itemName: '', quantity: 1, remainingQuantity: 0 }]);
  const [availablePoItems, setAvailablePoItems] = useState([]);
  const [notes, setNotes] = useState('Cartons verified at receiving dock, no external damage observed.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agentResult, setAgentResult] = useState(null);

  const fetchPoItems = async (chosenPo) => {
    if (!chosenPo) {
      setAvailablePoItems([]);
      return;
    }
    try {
      const res = await api.get(`/purchase-orders/${encodeURIComponent(chosenPo)}/delivery-tracker`);
      const poItems = res.data?.items || [];
      setAvailablePoItems(poItems);
      if (poItems.length) {
        // Pre-populate delivery items with the PO's remaining balance
        const prefilled = poItems.map(p => ({
          itemName: p.itemName,
          quantity: (p.remainingQuantity > 0 ? p.remainingQuantity : (p.remaining > 0 ? p.remaining : 1)),
          remainingQuantity: p.remainingQuantity ?? p.remaining ?? 0
        }));
        setItems(prefilled);
      }
    } catch (e) {
      console.warn('Could not fetch PO items for delivery:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDeliveryNumber(`DEL-${Math.floor(1000 + Math.random() * 9000)}`);
      setError('');
      setAgentResult(null);

      api.get('/purchase-orders').then(res => {
        const list = res.data || [];
        setPos(list);
        const targetPo = preselectedPoNumber || (list.length ? list[0].po_number : '');
        if (targetPo) {
          setPoNumber(targetPo);
          const matched = list.find(p => p.po_number === targetPo);
          if (matched) {
            setVendor(matched.vendor || '');
          }
          fetchPoItems(targetPo);
        }
      }).catch(() => {});
    }
  }, [isOpen, preselectedPoNumber]);

  const handlePoChange = e => {
    const chosenPo = e.target.value;
    setPoNumber(chosenPo);
    const matched = pos.find(p => p.po_number === chosenPo);
    if (matched) {
      setVendor(matched.vendor || '');
    }
    fetchPoItems(chosenPo);
  };

  if (!isOpen) return null;

  const addItem = () => {
    setItems([...items, { itemName: '', quantity: 1 }]);
  };

  const removeItem = index => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index, field, value) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!deliveryNumber.trim()) {
      setError('Delivery / Challan number is required.');
      return;
    }
    if (!poNumber) {
      setError('Target Purchase Order is required.');
      return;
    }
    for (const it of items) {
      const finalName = it.itemName === '__custom__' ? (it.customName || '').trim() : (it.itemName || '').trim();
      if (!finalName) {
        setError('Delivered item name is required.');
        return;
      }
      if (Number(it.quantity) <= 0) {
        setError('Delivered quantity must be greater than zero.');
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      const res = await api.post('/deliveries', {
        deliveryNumber: deliveryNumber.trim().toUpperCase(),
        deliveryDate,
        poNumber,
        vendor,
        items: items.map(it => ({
          itemName: it.itemName === '__custom__' ? (it.customName || '').trim() : (it.itemName || '').trim(),
          quantity: Number(it.quantity)
        })),
        notes
      });
      setAgentResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to process delivery');
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = () => {
    onLogged();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" onClick={e => e.stopPropagation()}>
        {agentResult ? (
          <div>
            <div style={{ textAlign: 'center', padding: '16px 0 20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', background: '#dcfce7', color: '#15803d', fontSize: '28px', marginBottom: '14px' }}>
                ✓
              </div>
              <h3 style={{ fontSize: '22px', margin: '0 0 6px' }}>AI Autonomous GRN Generated!</h3>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
                The AI Fulfillment Agent verified the shipment against <b>{agentResult.poNumber}</b> and recorded official goods receipt.
              </p>
            </div>

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '18px', marginBottom: '18px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <small style={{ color: '#166534', fontWeight: 600, display: 'block' }}>Official GRN Number</small>
                  <strong style={{ fontSize: '20px', color: '#14532d', fontFamily: 'monospace' }}>
                    {agentResult.grn?.grnNumber || agentResult.grn?.grn_number}
                  </strong>
                </div>
                <div>
                  <small style={{ color: '#166534', fontWeight: 600, display: 'block' }}>Delivery / Challan #</small>
                  <strong style={{ fontSize: '16px', color: '#14532d' }}>
                    {agentResult.delivery?.delivery_number || deliveryNumber}
                  </strong>
                </div>
                <div>
                  <small style={{ color: '#166534', fontWeight: 600, display: 'block' }}>PO Deliveries Done</small>
                  <strong style={{ fontSize: '16px', color: '#14532d' }}>
                    {agentResult.deliveryCount} Delivery Completed
                  </strong>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #dcfce7', paddingTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                  <b>Cumulative PO Fulfillment:</b>
                  <span>
                    {agentResult.fulfillment?.totalAccepted} / {agentResult.fulfillment?.totalOrdered} units ({agentResult.fulfillment?.fulfillmentPercent}%)
                  </span>
                </div>
                <div className="progress-bar-wrap">
                  <div
                    className={`progress-fill ${agentResult.fulfillment?.fulfillmentPercent >= 100 ? 'full' : 'partial'}`}
                    style={{ width: `${Math.min(agentResult.fulfillment?.fulfillmentPercent || 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {agentResult.grn?.inspectionNotes && (
              <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className="ai-badge">AI AGENT INSPECTION LOG</span>
                  <small style={{ color: 'var(--muted)' }}>Synthesized by Groq LPU LLM</small>
                </div>
                <p style={{ fontSize: '12px', margin: 0, lineHeight: 1.5, color: '#2d3748' }}>
                  {agentResult.grn.inspectionNotes}
                </p>
              </div>
            )}

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={handleFinish} style={{ minWidth: '180px' }}>
                Done & View Deliveries
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="modal-card-header">
              <div>
                <h3>Log Incoming Delivery</h3>
                <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>
                  Record shipment intake. The AI Agent will match items against the PO and generate the GRN.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={onClose}>×</button>
            </div>

            {error && (
              <div style={{ background: '#fff0ef', color: '#a53b33', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Delivery / Challan #:
                  <input
                    type="text"
                    required
                    value={deliveryNumber}
                    onChange={e => setDeliveryNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. DEL-5011"
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Delivery Date:
                  <input
                    type="date"
                    required
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Target Purchase Order:
                  <select
                    value={poNumber}
                    onChange={handlePoChange}
                    required
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px' }}
                  >
                    <option value="">-- Select Target Purchase Order --</option>
                    {pos.map(p => (
                      <option key={p.po_number} value={p.po_number}>
                        {p.po_number} - {p.vendor} ({p.total_accepted_quantity || 0}/{p.total_ordered_quantity || 0} units received)
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                  Vendor (Auto-detected):
                  <input
                    type="text"
                    readOnly
                    value={vendor}
                    placeholder="Auto-populated from PO"
                    style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px', background: '#f8faf9' }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <b style={{ fontSize: '13px' }}>Delivered Line Items</b>
                  <button type="button" className="btn-sm btn-outline" onClick={addItem}>
                    + Add Item
                  </button>
                </div>

                <table className="item-entry-table">
                  <thead>
                    <tr>
                      <th style={{ width: '65%' }}>Delivered Item Description</th>
                      <th style={{ width: '25%' }}>Delivered Qty</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          {availablePoItems.length > 0 ? (
                            <div style={{ display: 'grid', gap: '4px' }}>
                              <select
                                value={it.itemName}
                                onChange={e => {
                                  const selectedName = e.target.value;
                                  const matched = availablePoItems.find(p => p.itemName === selectedName);
                                  const next = [...items];
                                  next[idx].itemName = selectedName;
                                  if (matched) {
                                    const rem = matched.remainingQuantity ?? matched.remaining ?? 0;
                                    next[idx].remainingQuantity = rem;
                                    if (rem > 0) next[idx].quantity = rem;
                                  }
                                  setItems(next);
                                }}
                              >
                                <option value="">-- Choose Item from PO --</option>
                                {availablePoItems.map((p, i) => (
                                  <option key={i} value={p.itemName}>
                                    {p.itemName} ({p.remainingQuantity ?? p.remaining ?? 0} remaining of {p.orderedQuantity})
                                  </option>
                                ))}
                                <option value="__custom__">+ Enter other / custom item...</option>
                              </select>
                              {it.itemName === '__custom__' && (
                                <input
                                  type="text"
                                  required
                                  placeholder="Enter custom item name"
                                  value={it.customName || ''}
                                  onChange={e => {
                                    const next = [...items];
                                    next[idx].customName = e.target.value;
                                    setItems(next);
                                  }}
                                />
                              )}
                            </div>
                          ) : (
                            <input
                              type="text"
                              required
                              placeholder="Item description matching PO"
                              value={it.itemName}
                              onChange={e => updateItem(idx, 'itemName', e.target.value)}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            required
                            value={it.quantity}
                            onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          />
                          {it.remainingQuantity > 0 && (
                            <small style={{ color: 'var(--green)', fontSize: '10px', display: 'block', marginTop: '2px', fontWeight: 600 }}>
                              PO Remaining: {it.remainingQuantity} units
                            </small>
                          )}
                        </td>
                        <td>
                          {items.length > 1 && (
                            <button
                              type="button"
                              className="btn-sm"
                              style={{ background: '#fee2e2', color: '#b91c1c', border: 'none' }}
                              onClick={() => removeItem(idx)}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '20px' }}>
                Warehouse Inspection & Carrier Notes:
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes on packaging, courier, damage inspection..."
                  style={{ padding: '9px', border: '1px solid var(--line)', borderRadius: '6px', resize: 'vertical' }}
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="outline" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" disabled={busy}>
                  {busy ? 'AI Agent Verifying & Generating GRN…' : 'Process Delivery & Generate GRN'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Per-PO Delivery Tracker & GRN History Modal
// ----------------------------------------------------------------------------
function DeliveryTrackerModal({ isOpen, poNumber, onClose, onOpenLogDelivery, user }) {
  const [tracker, setTracker] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [returnModal, setReturnModal] = useState({ open: false, itemName: '', excessQty: 0 });
  const nav = useNavigate();
  const canLogDelivery = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE';

  const fetchTracker = () => {
    setLoading(true);
    api.get(`/purchase-orders/${encodeURIComponent(poNumber)}/delivery-tracker`)
      .then(res => {
        setTracker(res.data);
      })
      .catch(err => {
        console.error(err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen && poNumber) {
      fetchTracker();
    }
  }, [isOpen, poNumber]);

  if (!isOpen || !poNumber) return null;

  const summary = tracker?.summary || {};
  const fulfillmentPct = summary.fulfillmentPercent || 0;
  const hasTrackerExcess = tracker?.hasExcess || (tracker?.excessQuantity > 0) || tracker?.items?.some(i => i.excessQuantity > 0);
  const firstExcessItem = tracker?.items?.find(i => i.excessQuantity > 0) || tracker?.items?.[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-card-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0 }}>Delivery Tracker: {poNumber}</h3>
              {tracker?.singleGrnNumber && tracker.singleGrnNumber !== 'PENDING' && (
                <span className="badge grn" style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '12px' }}>
                  GRN: {tracker.singleGrnNumber}
                </span>
              )}
              {hasTrackerExcess && (
                <span className="badge more-received" style={{ fontSize: '11px', fontWeight: 'bold' }}>
                  ⚠️ OVER-DELIVERY (+{tracker.excessQuantity || firstExcessItem?.excessQuantity || 1})
                </span>
              )}
              {tracker && <Status>{tracker.poStatus}</Status>}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '4px 0 0' }}>
              Vendor: <b>{tracker?.vendor || '—'}</b> | Order Date: <b>{tracker?.orderDate ? new Date(tracker.orderDate).toLocaleDateString() : '—'}</b> | Total: <b>{money(tracker?.totalAmount)}</b>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <p style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>
            Loading delivery tracking records…
          </p>
        ) : tracker ? (
          <div>
            {/* Over-Delivery Alert & Quick RTV Action */}
            {hasTrackerExcess && (
              <div className="rtv-banner">
                <div>
                  <b style={{ color: '#92400e', fontSize: '13px' }}>
                    ⚠️ Inbound Over-Delivery: {tracker.excessQuantity || firstExcessItem?.excessQuantity || 0} Units Surplus
                  </b>
                  <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#b45309' }}>
                    Warehouse accepted {tracker.totalReceivedQuantity} units against authorized PO of {tracker.totalOrderedQuantity}. Return excess stock to vendor (RTV) to reconcile inventory and 3-way matching.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-rtv btn-sm"
                  onClick={() =>
                    setReturnModal({
                      open: true,
                      itemName: firstExcessItem?.itemName || '',
                      excessQty: tracker.excessQuantity || firstExcessItem?.excessQuantity || 1
                    })
                  }
                >
                  ↩ Return Excess Lot (RTV)
                </button>
              </div>
            )}

            {/* Scorecard Metrics Grid */}
            <div
              className="tracker-summary-grid"
              style={{
                gridTemplateColumns: tracker.totalReturnedQuantity > 0 ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)'
              }}
            >
              <div className="tracker-metric-box">
                <small>Official Single GRN #</small>
                <strong style={{ fontFamily: 'monospace', color: tracker.singleGrnNumber !== 'PENDING' ? '#14532d' : 'var(--muted)', fontSize: '14px' }}>
                  {tracker.singleGrnNumber || 'PENDING'}
                </strong>
              </div>
              <div className="tracker-metric-box">
                <small>Deliveries Done</small>
                <strong>{summary.totalDeliveries || 0} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--muted)' }}>Shipments</span></strong>
              </div>
              <div className="tracker-metric-box">
                <small>Net Accepted</small>
                <strong style={{ color: '#15803d' }}>
                  {summary.totalAcceptedQuantity || 0} <span style={{ fontSize: '12px', color: 'var(--muted)' }}>/ {summary.totalOrderedQuantity || 0}</span>
                </strong>
              </div>
              {tracker.totalReturnedQuantity > 0 && (
                <div className="tracker-metric-box">
                  <small>Returned to Vendor</small>
                  <strong style={{ color: '#b91c1c' }}>
                    {tracker.totalReturnedQuantity} <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Units</span>
                  </strong>
                </div>
              )}
              <div className="tracker-metric-box">
                <small>Remaining Balance</small>
                <strong style={{ color: summary.remainingQuantity > 0 ? '#b45309' : '#15803d' }}>
                  {summary.remainingQuantity || 0} <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Units</span>
                </strong>
              </div>
              <div className="tracker-metric-box">
                <small>Fulfillment Rate</small>
                <strong>{fulfillmentPct}%</strong>
              </div>
            </div>

            {/* Overall Progress Bar */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                <span>Inbound Delivery Completion</span>
                <b>{summary.totalAcceptedQuantity} of {summary.totalOrderedQuantity} Units Received ({fulfillmentPct}%)</b>
              </div>
              <div className="progress-bar-wrap" style={{ height: '10px' }}>
                <div
                  className={`progress-fill ${fulfillmentPct >= 100 ? 'full' : fulfillmentPct > 0 ? 'partial' : 'empty'}`}
                  style={{ width: `${Math.min(fulfillmentPct, 100)}%` }}
                />
              </div>
            </div>

            {/* AI Callout */}
            <div className="ai-agent-banner">
              <span className="ai-badge">AUTONOMOUS RECONCILIATION</span>
              <small style={{ color: '#166534', lineHeight: 1.4 }}>
                The AI Fulfillment Agent maintains a single official GRN for this Purchase Order, attaching multi-lot shipments and aggregating accepted quantities for 3-way invoice matching.
              </small>
            </div>

            {/* PO Line Items Breakdown */}
            <div style={{ marginBottom: '22px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>Ordered Items vs Received Status</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f7faf8' }}>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Item Name</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Ordered</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Gross Recv</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Returned (RTV)</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Net Accepted</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Remaining</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Fulfillment</th>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Status / Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tracker.items?.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #edf2ef' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{it.itemName}</td>
                      <td style={{ padding: '8px 10px' }}>{it.orderedQuantity} units</td>
                      <td style={{ padding: '8px 10px' }}>{it.grossAccepted ?? it.acceptedQuantity} units</td>
                      <td style={{ padding: '8px 10px', color: it.totalReturned > 0 ? '#b91c1c' : 'var(--muted)', fontWeight: it.totalReturned > 0 ? 600 : 'normal' }}>
                        {it.totalReturned > 0 ? `-${it.totalReturned} units` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#15803d', fontWeight: 600 }}>{it.acceptedQuantity} units</td>
                      <td style={{ padding: '8px 10px', color: it.remainingQuantity > 0 ? '#b45309' : '#64748b' }}>
                        {it.remainingQuantity} units
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="progress-bar-wrap" style={{ width: '50px', height: '6px', margin: 0 }}>
                            <div
                              className={`progress-fill ${it.fulfillmentPercent >= 100 ? 'full' : 'partial'}`}
                              style={{ width: `${Math.min(it.fulfillmentPercent, 100)}%` }}
                            />
                          </div>
                          <span>{it.fulfillmentPercent}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {it.excessQuantity > 0 ? (
                          <button
                            type="button"
                            className="btn-sm btn-rtv"
                            style={{ fontSize: '10px', padding: '3px 7px' }}
                            onClick={() =>
                              setReturnModal({
                                open: true,
                                itemName: it.itemName,
                                excessQty: it.excessQuantity
                              })
                            }
                          >
                            ↩ Return ({it.excessQuantity})
                          </button>
                        ) : (
                          <Status>{it.status}</Status>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Inbound Shipments Attached to Single GRN */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '14px' }}>
                  Inbound Shipments Attached to GRN <span style={{ fontFamily: 'monospace', color: 'var(--green)' }}>{tracker.singleGrnNumber || 'PENDING'}</span> ({tracker.deliveries?.length || 0})
                </h4>
                <small style={{ color: 'var(--muted)' }}>Multiple delivery shipments link to the single PO GRN</small>
              </div>
              {tracker.deliveries?.length ? (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {tracker.deliveries.map((d, index) => (
                    <div
                      key={d.id || index}
                      style={{
                        background: '#f8faf9',
                        border: '1px solid var(--line)',
                        borderRadius: '8px',
                        padding: '12px 14px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <b style={{ fontSize: '13px' }}>Shipment #{d.shipmentIndex || index + 1}: {d.delivery_number}</b>
                          <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '10px' }}>
                            Date: {new Date(d.delivery_date).toLocaleDateString()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span className="badge grn" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            Attached to {d.grn_number || tracker.singleGrnNumber}
                          </span>
                          <Status>{d.delivery_status || d.status}</Status>
                        </div>
                      </div>

                      {d.items && d.items.length > 0 && (
                        <div style={{ background: '#fff', border: '1px solid #d1e7dd', borderRadius: '6px', padding: '8px 12px', fontSize: '12px' }}>
                          <div style={{ fontWeight: 600, color: '#166534', marginBottom: '4px' }}>
                            Goods Received in this Lot:
                          </div>
                          {d.items.map((it, itIdx) => (
                            <div key={itIdx} style={{ display: 'flex', justifyContent: 'space-between', color: '#334155' }}>
                              <span>• {it.itemName}</span>
                              <b style={{ color: '#15803d' }}>{it.acceptedQuantity} units</b>
                            </div>
                          ))}
                        </div>
                      )}

                      {d.notes && (
                        <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
                          Inspection & Carrier Notes: "{d.notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', background: 'var(--paper)', borderRadius: '8px', color: 'var(--muted)', fontSize: '13px' }}>
                  No shipments logged yet for this Purchase Order.
                </div>
              )}
            </div>

            {/* Official Returns to Vendor (RTV Notes) */}
            {tracker.returns?.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', color: '#991b1b' }}>
                    ↩ Goods Returns to Vendor (RTV Notes) ({tracker.returns.length})
                  </h4>
                  <span className="badge returned">Surplus Deducted</span>
                </div>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {tracker.returns.map(ret => (
                    <div
                      key={ret.id}
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontFamily: 'monospace', color: '#b91c1c' }}>{ret.returnNumber}</strong>
                          <small style={{ color: 'var(--muted)' }}>{new Date(ret.returnDate).toLocaleDateString()}</small>
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#7f1d1d' }}>
                          {ret.itemName} · <b>{ret.quantity} units returned</b> · {ret.reason}
                        </p>
                      </div>
                      <span className="badge returned">{ret.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Associated Invoice / Auto-Generate Card */}
            {tracker.invoice ? (
              <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px 16px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Vendor Invoice</div>
                  <b style={{ fontSize: '14px', color: '#0f172a' }}>{tracker.invoice.invoice_number}</b>
                  <span style={{ marginLeft: '10px', fontSize: '12px', color: '#475569' }}>Total: {money(tracker.invoice.total_amount)}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <Status>{tracker.invoice.status}</Status>
                  <button
                    type="button"
                    className="btn-sm btn-outline"
                    onClick={() => {
                      onClose();
                      nav(`/invoices/${tracker.invoice.id}`);
                    }}
                  >
                    View 3-Way Match →
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b style={{ color: '#166534', fontSize: '13px' }}>⚡ Auto-Generate Vendor Invoice & Reconcile</b>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#15803d' }}>
                    Auto-creates the vendor invoice based on dock receipts and executes 3-way reconciliation immediately.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={async () => {
                    setIsGeneratingInvoice(true);
                    try {
                      const res = await api.post(`/purchase-orders/${encodeURIComponent(poNumber)}/auto-invoice`);
                      onClose();
                      nav(`/invoices/${res.data.invoiceId}`);
                    } catch (err) {
                      alert(`Auto-invoice error: ${err.response?.data?.error || err.message}`);
                    } finally {
                      setIsGeneratingInvoice(false);
                    }
                  }}
                  disabled={isGeneratingInvoice}
                >
                  {isGeneratingInvoice ? 'Reconciling…' : '⚡ Generate & Match Invoice'}
                </button>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '20px', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {canLogDelivery && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      onClose();
                      onOpenLogDelivery(poNumber);
                    }}
                  >
                    + Log Delivery For This PO
                  </button>
                )}
                {hasTrackerExcess && (
                  <button
                    type="button"
                    className="btn-rtv"
                    onClick={() =>
                      setReturnModal({
                        open: true,
                        itemName: firstExcessItem?.itemName || '',
                        excessQty: tracker.excessQuantity || firstExcessItem?.excessQuantity || 1
                      })
                    }
                  >
                    ↩ Return Excess Lot (RTV)
                  </button>
                )}
              </div>
              <button type="button" onClick={onClose} style={!canLogDelivery && !hasTrackerExcess ? { marginLeft: 'auto' } : {}}>
                Close Tracker
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: '#b91c1c' }}>Purchase Order details not found.</p>
        )}

        {/* Return Excess Modal inside Tracker */}
        <ReturnExcessModal
          isOpen={returnModal.open}
          poNumber={poNumber}
          initialItemName={returnModal.itemName}
          initialExcessQty={returnModal.excessQty}
          user={user}
          onClose={() => setReturnModal({ open: false, itemName: '', excessQty: 0 })}
          onReturned={fetchTracker}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Purchase Orders View
// ----------------------------------------------------------------------------
function PurchaseOrdersView({ user }) {
  const [data, setData] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [trackerPo, setTrackerPo] = useState(null);
  const [logDeliveryPo, setLogDeliveryPo] = useState(null);
  const [returnPo, setReturnPo] = useState(null);

  const role = user?.role || 'ADMIN';
  const canCreatePO = role === 'ADMIN' || role === 'PURCHASER';
  const canLogDelivery = role === 'ADMIN' || role === 'WAREHOUSE';

  const loadData = () => {
    api.get('/purchase-orders').then(res => setData(res.data || []));
  };

  useEffect(() => {
    loadData();
    const handleRefresh = () => loadData();
    window.addEventListener('erp-data-updated', handleRefresh);
    return () => window.removeEventListener('erp-data-updated', handleRefresh);
  }, []);

  const filtered = useMemo(() => {
    return data.filter(p => {
      const matchSearch =
        p.po_number.toLowerCase().includes(search.toLowerCase()) ||
        p.vendor.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filter === 'all') return true;
      return String(p.status).toUpperCase() === filter.toUpperCase();
    });
  }, [data, search, filter]);

  return (
    <>
      <Title
        title="Purchase Orders"
        text="ERP Purchase Orders with real-time multi-delivery tracking, cumulative quantities, and agent GRN status."
        action={
          canCreatePO ? (
            <button type="button" onClick={() => setIsCreateOpen(true)}>
              + Create Purchase Order
            </button>
          ) : (
            <span className="role-tag role-tag-warehouse" style={{ fontSize: '12px', padding: '6px 12px' }}>
              📦 Warehouse Reference View
            </span>
          )
        }
      />

      {role === 'WAREHOUSE' && (
        <div className="role-permission-banner" style={{ background: '#fff9f0', borderColor: '#fed7aa' }}>
          <div>
            <b>📦 Warehouse Receiving Reference:</b> Purchase Orders display contracted quantities and items so you can cross-check expected shipments at the dock. Use <b>+ Delivery</b> to record received lots.
          </div>
        </div>
      )}

      <div className="search-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search by PO # or vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-pills">
          {['all', 'open', 'partially_delivered', 'delivered'].map(f => (
            <button
              type="button"
              key={f}
              className={`filter-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.replace(/_/g, ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <Table
        cols={[
          'PO #',
          'Single GRN #',
          'Vendor',
          'Order Date',
          'Items',
          'Deliveries Done',
          'Inbound Fulfillment',
          'Total Amount',
          'Status',
          'Actions'
        ]}
        rows={filtered.map(p => {
          const accepted = Number(p.total_accepted_quantity) || 0;
          const ordered = Number(p.total_ordered_quantity) || 0;
          const returned = Number(p.total_returned_quantity) || 0;
          const over = Math.max(0, accepted - ordered);
          const pct = ordered > 0 ? Math.min(Math.round((accepted / ordered) * 100), 100) : 0;
          const delCount = Number(p.delivery_count) || 0;

          return [
            <b style={{ fontFamily: 'monospace', fontSize: '13px' }}>{p.po_number}</b>,
            p.grn_number ? (
              <span className="badge grn" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                {p.grn_number}
              </span>
            ) : (
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Pending</span>
            ),
            p.vendor,
            new Date(p.order_date).toLocaleDateString(),
            <span>{p.item_count || 1} items</span>,
            <span
              className={`badge ${delCount > 0 ? 'grn' : 'uploaded'}`}
              style={{ cursor: 'pointer', padding: '5px 10px' }}
              onClick={() => setTrackerPo(p.po_number)}
              title="Click to view delivery history"
            >
              {delCount} {delCount === 1 ? 'Delivery' : 'Deliveries'}
            </span>,
            <div style={{ minWidth: '130px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                <span>{accepted}/{ordered} units</span>
                <b>{pct}%</b>
              </div>
              <div className="progress-bar-wrap" style={{ height: '6px', margin: 0 }}>
                <div
                  className={`progress-fill ${pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {over > 0 && (
                <span className="badge more-received" style={{ fontSize: '9px', padding: '1px 5px', marginTop: '3px', display: 'inline-block' }}>
                  +{over} OVER-DELIVERY
                </span>
              )}
              {returned > 0 && (
                <span className="badge returned" style={{ fontSize: '9px', padding: '1px 5px', marginTop: '3px', marginLeft: '4px', display: 'inline-block' }}>
                  -{returned} RTV
                </span>
              )}
            </div>,
            <b>{money(p.total_amount)}</b>,
            <Status>{p.status}</Status>,
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn-sm btn-outline"
                onClick={() => setTrackerPo(p.po_number)}
                title="View full delivery & GRN tracker"
              >
                Track Deliveries
              </button>
              {over > 0 && (
                <button
                  type="button"
                  className="btn-sm btn-rtv"
                  onClick={() => setReturnPo(p.po_number)}
                  title="Return excess received items back to vendor"
                >
                  ↩ Return Excess
                </button>
              )}
              {canLogDelivery && (
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => setLogDeliveryPo(p.po_number)}
                  title="Log new delivery against this PO"
                >
                  + Delivery
                </button>
              )}
            </div>
          ];
        })}
        emptyMsg="No Purchase Orders found matching filter."
      />

      {/* Modals */}
      <CreatePOModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={loadData}
      />

      <LogDeliveryModal
        isOpen={!!logDeliveryPo}
        preselectedPoNumber={logDeliveryPo}
        onClose={() => setLogDeliveryPo(null)}
        onLogged={loadData}
      />

      <DeliveryTrackerModal
        isOpen={!!trackerPo}
        poNumber={trackerPo}
        user={user}
        onClose={() => setTrackerPo(null)}
        onOpenLogDelivery={po => {
          setTrackerPo(null);
          setLogDeliveryPo(po);
        }}
      />

      <ReturnExcessModal
        isOpen={!!returnPo}
        poNumber={returnPo}
        user={user}
        onClose={() => setReturnPo(null)}
        onReturned={loadData}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Deliveries & GRNs View
// ----------------------------------------------------------------------------
function DeliveriesView({ user }) {
  const [deliveries, setDeliveries] = useState([]);
  const [poSummary, setPoSummary] = useState([]);
  const [tab, setTab] = useState('summary'); // 'summary' | 'all'
  const [search, setSearch] = useState('');
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [trackerPo, setTrackerPo] = useState(null);
  const [logDeliveryPo, setLogDeliveryPo] = useState(null);
  const [returnPo, setReturnPo] = useState(null);

  const role = user?.role || 'ADMIN';
  const canLogDelivery = role === 'ADMIN' || role === 'WAREHOUSE';

  const loadData = () => {
    api.get('/deliveries').then(res => {
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setDeliveries(list);
    });
    api.get('/deliveries/summary-by-po').then(res => {
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setPoSummary(list);
    });
  };

  useEffect(() => {
    loadData();
    const handleRefresh = () => loadData();
    window.addEventListener('erp-data-updated', handleRefresh);
    return () => window.removeEventListener('erp-data-updated', handleRefresh);
  }, []);

  const filteredSummary = useMemo(() => {
    return poSummary.filter(p => {
      const num = p.po_number || p.poNumber || '';
      const ven = p.vendor || p.vendorName || '';
      return (
        num.toLowerCase().includes(search.toLowerCase()) ||
        ven.toLowerCase().includes(search.toLowerCase())
      );
    });
  }, [poSummary, search]);

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter(d =>
      d.delivery_number.toLowerCase().includes(search.toLowerCase()) ||
      d.po_number.toLowerCase().includes(search.toLowerCase()) ||
      d.vendor.toLowerCase().includes(search.toLowerCase()) ||
      (d.grn_number && d.grn_number.toLowerCase().includes(search.toLowerCase()))
    );
  }, [deliveries, search]);

  return (
    <>
      <Title
        title="Deliveries & Agent GRNs"
        text="AI Agent matches inbound deliveries to POs and autonomously generates sequential Goods Receipt Notes (GRN)."
        action={
          canLogDelivery ? (
            <button type="button" onClick={() => setIsLogOpen(true)}>
              + Log Incoming Delivery
            </button>
          ) : (
            <span className="role-tag role-tag-purchaser" style={{ fontSize: '12px', padding: '6px 12px' }}>
              🛒 Procurement Fulfillment View
            </span>
          )
        }
      />

      {role === 'PURCHASER' && (
        <div className="role-permission-banner" style={{ background: '#f0f7ff', borderColor: '#bfdbfe' }}>
          <div>
            <b>🛒 Procurement Inbound Monitor:</b> Review fulfillment scorecards and AI-generated GRNs logged by warehouse dock staff against your orders.
          </div>
        </div>
      )}

      <div className="search-controls">
        <div className="filter-pills">
          <button
            type="button"
            className={`filter-pill ${tab === 'summary' ? 'active' : ''}`}
            onClick={() => setTab('summary')}
          >
            Per-PO Delivery Tracker (Scorecard)
          </button>
          <button
            type="button"
            className={`filter-pill ${tab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
          >
            All Shipments & GRNs ({deliveries.length})
          </button>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder={tab === 'summary' ? 'Search PO # or vendor...' : 'Search delivery #, PO, GRN...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {tab === 'summary' ? (
        <Table
          cols={[
            'PO #',
            'Vendor',
            'Deliveries Completed',
            'Inbound Fulfillment',
            'Remaining Balance',
            'Single GRN #',
            'PO Status',
            'Actions'
          ]}
          rows={filteredSummary.map(p => {
            const poNum = p.po_number || p.poNumber;
            const vendor = p.vendor || p.vendorName;
            const deliveriesCount = p.totalDeliveriesCount ?? p.deliveries_count ?? 0;
            const accepted = p.totalReceivedQuantity ?? p.total_accepted_quantity ?? 0;
            const ordered = p.totalOrderedQuantity ?? p.total_ordered_quantity ?? 0;
            const remaining = p.totalRemainingQuantity ?? p.remaining_quantity ?? 0;
            const over = Math.max(0, accepted - ordered);
            const pct = p.overallFulfillmentPercentage ?? p.fulfillment_percent ?? (ordered > 0 ? Math.round((accepted / ordered) * 100) : 0);
            const poStatus = p.status || p.po_status || 'OPEN';

            let grnList = p.grn_numbers || [];
            if (!grnList.length && p.deliveries) {
              grnList = p.deliveries.flatMap(d => (d.grns || []).map(g => g.grnNumber || g.grn_number)).filter(Boolean);
            }
            const singleGrn = p.singleGrnNumber || p.grnNumber || p.grn_number || (grnList.length ? grnList[0] : null);

            return [
              <b style={{ fontFamily: 'monospace', fontSize: '13px' }}>{poNum}</b>,
              vendor,
              <span
                className="badge grn"
                style={{ cursor: 'pointer', padding: '5px 10px' }}
                onClick={() => setTrackerPo(poNum)}
              >
                {deliveriesCount} {deliveriesCount === 1 ? 'Delivery' : 'Deliveries'}
              </span>,
              <div style={{ minWidth: '140px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                  <span>{accepted} / {ordered} units</span>
                  <b>{pct}%</b>
                </div>
                <div className="progress-bar-wrap" style={{ height: '6px', margin: 0 }}>
                  <div
                    className={`progress-fill ${pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                {over > 0 && (
                  <span className="badge more-received" style={{ fontSize: '9px', padding: '1px 5px', marginTop: '3px', display: 'inline-block' }}>
                    +{over} OVER-DELIVERY
                  </span>
                )}
              </div>,
              <b style={{ color: remaining > 0 ? '#b45309' : '#15803d' }}>
                {remaining} units
              </b>,
              <div>
                {singleGrn && singleGrn !== 'PENDING' ? (
                  <span className="badge grn" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {singleGrn}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Pending</span>
                )}
              </div>,
              <Status>{poStatus}</Status>,
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn-sm btn-outline"
                  onClick={() => setTrackerPo(poNum)}
                >
                  View Tracker
                </button>
                {over > 0 && (
                  <button
                    type="button"
                    className="btn-sm btn-rtv"
                    onClick={() => setReturnPo(poNum)}
                    title="Return excess received items"
                  >
                    ↩ Return Excess
                  </button>
                )}
                {canLogDelivery && (
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => setLogDeliveryPo(poNum)}
                  >
                    + Delivery
                  </button>
                )}
              </div>
            ];
          })}
          emptyMsg="No Purchase Order delivery scorecards found."
        />
      ) : (
        <Table
          cols={[
            'Delivery #',
            'PO #',
            'Vendor',
            'Delivery Date',
            'Agent GRN #',
            'Item Delivered',
            'Accepted Qty',
            'Status',
            'Action'
          ]}
          rows={filteredDeliveries.map(d => [
            <b>{d.delivery_number}</b>,
            d.po_number,
            d.vendor,
            new Date(d.delivery_date).toLocaleDateString(),
            d.grn_number ? (
              <span className="badge grn">{d.grn_number}</span>
            ) : (
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Pending</span>
            ),
            d.item_name || '—',
            <b>{d.accepted_quantity ? `${Number(d.accepted_quantity)} units` : '—'}</b>,
            <Status>{d.delivery_status}</Status>,
            <button
              type="button"
              className="btn-sm btn-outline"
              onClick={() => setTrackerPo(d.po_number)}
            >
              Track PO
            </button>
          ])}
          emptyMsg="No deliveries recorded yet."
        />
      )}

      {/* Modals */}
      <LogDeliveryModal
        isOpen={isLogOpen || !!logDeliveryPo}
        preselectedPoNumber={logDeliveryPo}
        onClose={() => {
          setIsLogOpen(false);
          setLogDeliveryPo(null);
        }}
        onLogged={loadData}
      />

      <DeliveryTrackerModal
        isOpen={!!trackerPo}
        poNumber={trackerPo}
        user={user}
        onClose={() => setTrackerPo(null)}
        onOpenLogDelivery={po => {
          setTrackerPo(null);
          setLogDeliveryPo(po);
        }}
      />

      <ReturnExcessModal
        isOpen={!!returnPo}
        poNumber={returnPo}
        user={user}
        onClose={() => setReturnPo(null)}
        onReturned={loadData}
      />
    </>
  );
}

// Backward compatibility alias for any existing reference
function PurchaseOrders({ deliveries = false }) {
  return deliveries ? <DeliveriesView /> : <PurchaseOrdersView />;
}

// ----------------------------------------------------------------------------
// Batches Component
// ----------------------------------------------------------------------------
function Batches() {
  const [batches, setBatches] = useState([]);

  useEffect(() => {
    api.get('/batches').then(res => setBatches(res.data));
  }, []);

  return (
    <>
      <Title
        title="Batch Processing History"
        text="Review bulk invoice ingestion batches and row-level resilient execution."
      />
      <Table
        cols={['Batch Number', 'Total Rows', 'Processed', 'Status', 'Created At']}
        rows={batches.map(b => [
          <b>{b.batch_number}</b>,
          b.total_count,
          b.processed_count,
          <Status>{b.status}</Status>,
          new Date(b.created_at).toLocaleString()
        ])}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Audit History Component (TC-08)
// ----------------------------------------------------------------------------
function Audit() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.get('/audit-logs').then(res => setLogs(res.data));
  }, []);

  return (
    <>
      <Title
        title="Audit History"
        text="Immutable chronological audit trail of all AI matching actions, approvals, and system events."
      />
      <Table
        cols={['Timestamp', 'Action', 'Entity', 'Details']}
        rows={logs.map(l => [
          new Date(l.created_at).toLocaleString(),
          <Status>{l.action}</Status>,
          `${l.entity_type} #${l.entity_id}`,
          l.details
        ])}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Login Component
// ----------------------------------------------------------------------------
const PRESET_USERS = [
  {
    role: 'ADMIN',
    badge: '👑 ADMIN',
    name: 'Alex Admin',
    email: 'admin@example.com',
    password: 'demo123',
    sub: 'Full Access · POs, Invoices, Deliveries, Approvals & System Tools'
  },
  {
    role: 'PURCHASER',
    badge: '🛒 PURCHASER',
    name: 'Peter Purchaser',
    email: 'purchaser@example.com',
    password: 'demo123',
    sub: 'Procurement · Create POs, Upload Invoices & Track Deliveries'
  },
  {
    role: 'WAREHOUSE',
    badge: '📦 WAREHOUSE',
    name: 'Vikram Warehouse',
    email: 'warehouse@example.com',
    password: 'demo123',
    sub: 'Dock Staff · Log Inbound Deliveries & Generate Sequential GRNs'
  }
];

function Login({ onSignIn }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('demo123');
  const [selectedRole, setSelectedRole] = useState('ADMIN');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectPreset = p => {
    setSelectedRole(p.role);
    setEmail(p.email);
    setPassword(p.password);
    setError('');
  };

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/login', { email, password });
      onSignIn(res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-visual">
        <div className="login-brand">
          <span>AI</span> Reconcile
        </div>
        <div className="visual-copy">
          <p className="eyebrow">FINANCE & LOGISTICS, CLARIFIED</p>
          <h1>
            Every invoice.
            <br />
            Every shipment.
            <br />
            One clear truth.
          </h1>
          <p>
            Role-based autonomous 3-way reconciliation powered by Groq LPU inference. Real-time PO creation, dock delivery logging, sequential GRN generation, and deterministic matching.
          </p>
          <div className="trust">
            <span>✓</span> Multi-user permissions · Audit-ready compliance
          </div>
        </div>
        <div className="orb orb-one" />
        <div className="orb orb-two" />
      </div>

      <section className="login-panel">
        <form onSubmit={submit} className="login-card">
          <div className="mobile-brand">
            <span>AI</span> Reconcile
          </div>
          <p className="eyebrow">SECURE WORKSPACE</p>
          <h1>Sign in to workspace</h1>
          <p className="login-subtitle">Select a demo role or enter your credentials.</p>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--muted)', marginBottom: '8px', display: 'block' }}>
              Quick Role Switcher (1-Click Fill):
            </label>
            <div className="role-picker">
              {PRESET_USERS.map(p => (
                <div
                  key={p.role}
                  className={`role-tile ${selectedRole === p.role ? 'active' : ''}`}
                  onClick={() => selectPreset(p)}
                >
                  <div style={{ width: '100%' }}>
                    <div className="role-tile-title">
                      <span>{p.badge.split(' ')[0]}</span>
                      <span>{p.name}</span>
                      <span className={`role-tag ${getRoleTagClass(p.role)}`} style={{ marginLeft: 'auto' }}>
                        {p.role}
                      </span>
                    </div>
                    <div className="role-tile-sub">{p.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label>
            Work email
            <input
              value={email}
              type="email"
              autoComplete="email"
              onChange={e => {
                setEmail(e.target.value);
                const matched = PRESET_USERS.find(p => p.email.toLowerCase() === e.target.value.toLowerCase());
                setSelectedRole(matched ? matched.role : null);
              }}
              required
            />
          </label>

          <label>
            Password
            <input
              value={password}
              type="password"
              autoComplete="current-password"
              onChange={e => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button className="login-submit" disabled={busy}>
            {busy ? 'Signing in…' : `Sign in as ${selectedRole || 'User'}`} <span>→</span>
          </button>

          <p className="demo-hint">
            Default password: <b>demo123</b> for all accounts.
          </p>
        </form>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Protected Application Container
// ----------------------------------------------------------------------------
function ProtectedApp({ user, onSignOut, onSwitchRole }) {
  const [aiInfo, setAiInfo] = useState(null);
  const [isResetting, setIsResetting] = useState(false);

  const checkHealth = () => {
    api.get('/health').then(res => setAiInfo(res.data)).catch(() => {});
  };

  useEffect(() => {
    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleResetData = async () => {
    if (user?.role !== 'ADMIN') {
      alert('Only administrators can reset test data.');
      return;
    }
    if (!window.confirm('Reset all demo invoices back to UPLOADED state and clear test approvals?')) {
      return;
    }
    setIsResetting(true);
    try {
      await api.post('/system/reset-demo');
      alert('Database seed reset complete! All seed invoices are now in UPLOADED state.');
      window.location.href = '/invoices';
    } catch (err) {
      alert(`Reset failed: ${err.message}`);
    } finally {
      setIsResetting(false);
    }
  };

  const isWarehouse = user?.role === 'WAREHOUSE';
  const isPurchaser = user?.role === 'PURCHASER';

  return (
    <Shell
      user={user}
      onSignOut={onSignOut}
      aiInfo={aiInfo}
      onResetData={handleResetData}
      isResetting={isResetting}
      onSwitchRole={onSwitchRole}
    >
      <Routes>
        <Route path="/" element={<Dashboard aiInfo={aiInfo} user={user} />} />

        {/* Invoices: Admin, Purchaser, Reviewer only */}
        <Route
          path="/invoices"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : <InvoiceList user={user} />}
        />
        <Route
          path="/invoices/:id"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : <InvoiceDetail user={user} />}
        />

        {/* Approval Queue: Admin & Reviewer only */}
        <Route
          path="/exceptions"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : isPurchaser ? <Navigate to="/purchase-orders" replace /> : <Exceptions user={user} />}
        />
        <Route
          path="/approvals"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : isPurchaser ? <Navigate to="/purchase-orders" replace /> : <Exceptions user={user} />}
        />

        {/* Invoice Upload: Admin & Purchaser only */}
        <Route
          path="/upload"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : <Upload user={user} />}
        />
        <Route
          path="/bulk"
          element={isWarehouse ? <Navigate to="/deliveries" replace /> : <Upload bulk user={user} />}
        />

        {/* Purchase Orders: All roles (view or create tailored) */}
        <Route path="/purchase-orders" element={<PurchaseOrdersView user={user} />} />

        {/* Deliveries & GRNs: All roles (dock logging vs procurement tracking) */}
        <Route path="/deliveries" element={<DeliveriesView user={user} />} />

        {/* Batches & Audit: Admin only */}
        <Route
          path="/batches"
          element={user?.role === 'ADMIN' ? <Batches user={user} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/audit"
          element={user?.role === 'ADMIN' ? <Audit user={user} /> : <Navigate to="/" replace />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

// ----------------------------------------------------------------------------
// Root App
// ----------------------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('reconcile_user'));
    } catch {
      return null;
    }
  });

  const signIn = u => {
    localStorage.setItem('reconcile_user', JSON.stringify(u));
    setUser(u);
  };

  const signOut = () => {
    localStorage.removeItem('reconcile_user');
    setUser(null);
  };

  const switchRole = roleName => {
    const preset = PRESET_USERS.find(p => p.role === roleName);
    if (preset) {
      const u = {
        id: preset.role === 'ADMIN' ? 1 : preset.role === 'PURCHASER' ? 2 : 3,
        name: preset.name,
        email: preset.email,
        role: preset.role
      };
      localStorage.setItem('reconcile_user', JSON.stringify(u));
      setUser(u);
    }
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login onSignIn={signIn} />}
      />
      <Route
        path="*"
        element={user ? <ProtectedApp user={user} onSignOut={signOut} onSwitchRole={switchRole} /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}

