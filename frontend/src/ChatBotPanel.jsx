import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './services/api';

function formatText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const parts = [];
    let remaining = line;
    let keyIdx = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      const codeMatch = remaining.match(/`(.*?)`/);

      let firstMatch = null;
      let matchType = null;

      if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
        firstMatch = boldMatch;
        matchType = 'bold';
      } else if (codeMatch) {
        firstMatch = codeMatch;
        matchType = 'code';
      }

      if (!firstMatch) {
        parts.push(<span key={keyIdx++}>{remaining}</span>);
        break;
      }

      const matchStart = firstMatch.index;
      if (matchStart > 0) {
        parts.push(<span key={keyIdx++}>{remaining.substring(0, matchStart)}</span>);
      }

      if (matchType === 'bold') {
        parts.push(<strong key={keyIdx++} style={{ color: 'var(--ink)' }}>{firstMatch[1]}</strong>);
      } else if (matchType === 'code') {
        parts.push(
          <code
            key={keyIdx++}
            style={{
              background: '#eef3f0',
              color: '#0d6a53',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace'
            }}
          >
            {firstMatch[1]}
          </code>
        );
      }

      remaining = remaining.substring(matchStart + firstMatch[0].length);
    }

    return (
      <div key={lineIdx} style={{ minHeight: line.trim() ? 'auto' : '6px', marginBottom: '3px' }}>
        {parts.length ? parts : <br />}
      </div>
    );
  });
}

function getDefaultRoleWelcome(role, userName) {
  const r = (role || 'ADMIN').toUpperCase();
  if (r === 'PURCHASER') {
    return {
      id: 'welcome-purchaser',
      sender: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `🛒 **Procurement Workspace (Peter Purchaser)**\n\n` +
        `Hello **${userName}**! You have authorization to create Purchase Orders and initiate buy contracts.\n\n` +
        `• 🛒 **Buy Items:** Type *"buy 20 laptops"* or *"buy 15 monitors from XYZ Displays"*.\n` +
        `• 📋 **Check Orders:** Type *"status of PO-1001"* to see fulfillment progress.\n` +
        `• ℹ️ *Note: Warehouse dock staff records received deliveries, and Reviewers approve invoices.*`
    };
  }

  if (r === 'WAREHOUSE') {
    return {
      id: 'welcome-warehouse',
      sender: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `📦 **Inbound Dock Logistics (Vikram Warehouse)**\n\n` +
        `Hello **${userName}**! You have dockside receiving authority to log inbound goods and issue GRNs.\n\n` +
        `• 📥 **Log Delivery:** Type *"I had received 15 laptops"* or *"received 10 laptops for PO-1001"*.\n` +
        `• 🚚 **Autonomous GRN:** Shipments are linked to the PO's single GRN, auto-unblocking 3-way invoice matching.\n` +
        `• ℹ️ *Note: Purchase orders are issued by Procurement, and invoice approvals are handled by Reviewers.*`
    };
  }

  if (r === 'REVIEWER') {
    return {
      id: 'welcome-reviewer',
      sender: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `🔍 **Reconciliation & Approval Queue (Priya Reviewer)**\n\n` +
        `Hello **${userName}**! You have audit oversight to inspect invoice receiving status and approve invoices.\n\n` +
        `• 📄 **Check Invoice Status:** Type *"check invoice INV-1001"* or *"how many received how many left for INV-1001"*.\n` +
        `• 🔍 **Inspect Discrepancies:** I will detail invoiced qty, received qty, remaining units, and receiving issues.\n` +
        `• ✅ **Approve Invoice:** If everything is right, click the **Approve** button or type *"approve invoice INV-1001"*!`
    };
  }

  return {
    id: 'welcome-admin',
    sender: 'bot',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: `👑 **Admin Enterprise Console (Alex Admin)**\n\n` +
      `Hello **${userName}**! Full administrative authority across all modules.\n\n` +
      `• 🛒 **Buy:** Type *"buy 20 laptops"* to auto-create Purchase Orders.\n` +
      `• 📥 **Receive:** Type *"received 15 laptops for PO-1001"* to log dock deliveries & GRNs.\n` +
      `• 📄 **Inspect & Approve:** Type *"check invoice INV-1001"* to see received vs remaining units, and *"approve invoice INV-1001"* to approve.`
  };
}

export default function ChatBotPanel({
  user,
  isOpen,
  onToggle,
  onDataRefresh
}) {
  const navigate = useNavigate();
  const role = (user?.role || 'ADMIN').toUpperCase();
  const userName = user?.name || 'User';

  // Strictly isolated storage key for each user account based on id or email
  const userIdentifier = user?.id
    ? `id_${user.id}`
    : user?.email
    ? user.email.toLowerCase().replace(/[^a-z0-9]/g, '_')
    : (user?.role || 'guest').toLowerCase();
  const userStorageKey = `reconcile_chat_user_${userIdentifier}`;

  // Docking position: 'right' (default) or 'left'
  const [dockPosition, setDockPosition] = useState(() => {
    return localStorage.getItem('reconcile_chat_dock_pos') || 'right';
  });

  // User-perspective chat history: Load user's dedicated messages from localStorage
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(userStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      // Check legacy keys for migration if user already had previous chats
      if (user?.email) {
        const legacy = localStorage.getItem(`reconcile_chat_${user.email}`);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch {}
    return [getDefaultRoleWelcome(role, userName)];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // When active user changes: load that specific user's perspective chat history
  const activeKeyRef = useRef(userStorageKey);
  useEffect(() => {
    if (activeKeyRef.current !== userStorageKey) {
      activeKeyRef.current = userStorageKey;
      try {
        const saved = localStorage.getItem(userStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            return;
          }
        }
      } catch {}
      setMessages([getDefaultRoleWelcome(role, userName)]);
    }
  }, [userStorageKey, role, userName]);

  // Persist messages whenever they change for the current user
  useEffect(() => {
    try {
      localStorage.setItem(userStorageKey, JSON.stringify(messages));
    } catch {}
  }, [messages, userStorageKey]);

  // Auto-scroll messages to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const toggleDockPosition = () => {
    const next = dockPosition === 'right' ? 'left' : 'right';
    setDockPosition(next);
    localStorage.setItem('reconcile_chat_dock_pos', next);
  };

  // Helper to detect if user input is entering a command to clear chat
  const isClearChatCommand = (text) => {
    const normalized = String(text || '').trim().toLowerCase().replace(/[.!?,]/g, '');
    return (
      /\b(clear\s*(?:the\s*)?(?:my\s*)?chat|clearchat|delete\s*(?:the\s*)?(?:my\s*)?chat|wipe\s*(?:the\s*)?(?:my\s*)?chat|reset\s*(?:the\s*)?(?:my\s*)?chat)\b/i.test(normalized) ||
      /^(?:clear|\/clear|clear\s*history|clear\s*my\s*chat|delete\s*my\s*chat)$/i.test(normalized)
    );
  };

  // Delete all chat history up to this point for this specific user only
  const executeClearChat = () => {
    const welcome = getDefaultRoleWelcome(role, userName);
    const clearedMsg = {
      id: 'cleared-' + Date.now(),
      sender: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `🧹 **Chat Cleared:** All chat messages up to this point have been deleted for **${userName}**.\n\nYou can start a fresh conversation below.`
    };
    const freshMessages = [welcome, clearedMsg];
    setMessages(freshMessages);
    try {
      localStorage.setItem(userStorageKey, JSON.stringify(freshMessages));
    } catch {}
    setInput('');
  };

  const handleSend = async (messageText) => {
    const query = (messageText || input).trim();
    if (!query || loading) return;

    // 1. If user entered "clear chat", delete their chat history up to this point immediately
    if (isClearChatCommand(query)) {
      executeClearChat();
      return;
    }

    const userMsg = {
      id: 'usr-' + Date.now(),
      sender: 'user',
      userName,
      userRole: role,
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/chat', {
        message: query,
        user: {
          id: user?.id,
          name: userName,
          role: role,
          email: user?.email
        }
      });

      const reply = res.data;

      // Check if backend responded to clear chat
      if (reply.clearChat || reply.intent === 'CLEAR_CHAT') {
        executeClearChat();
        return;
      }

      const botMsg = {
        id: 'bot-' + Date.now(),
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: reply.message,
        intent: reply.intent,
        data: reply.data,
        roleDenied: reply.roleDenied,
        actionAttempted: reply.actionAttempted
      };

      setMessages(prev => [...prev, botMsg]);

      // If action updated data (PO, delivery, approval), trigger sync across tables
      if (reply.requiresRefresh) {
        if (onDataRefresh) onDataRefresh();
        window.dispatchEvent(new CustomEvent('erp-data-updated', { detail: reply }));
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: 'err-' + Date.now(),
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `❌ **Error:** ${err.response?.data?.error || err.message || 'Failed to process request.'}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Role prompt suggestions tailored to active user
  const promptSuggestions = [
    ...(role === 'PURCHASER'
      ? [
          { label: '🛒 Buy 20 Laptops', text: 'buy 20 laptops from ABC Supplies' },
          { label: '🛒 Buy 15 Monitors', text: 'buy 15 monitors from XYZ Displays' },
          { label: '📋 Status of PO-1001', text: 'status of PO-1001' }
        ]
      : []),
    ...(role === 'WAREHOUSE'
      ? [
          { label: '📦 Received 15 Laptops', text: 'I had received 15 laptops' },
          { label: '📦 Received 10 for PO-1001', text: 'received 10 laptops for PO-1001' },
          { label: '📋 Delivery Tracker', text: 'status of PO-1001' }
        ]
      : []),
    ...(role === 'REVIEWER'
      ? [
          { label: '🔍 Check Invoice INV-1001', text: 'check invoice INV-1001 how many received how many left and is there any issues in receiving' },
          { label: '🔍 Check Invoice INV-2478', text: 'check invoice INV-2478' },
          { label: '✅ Approve INV-2478', text: 'approve invoice INV-2478' }
        ]
      : []),
    ...(role === 'ADMIN'
      ? [
          { label: '🛒 Buy 20 Laptops', text: 'buy 20 laptops from ABC Supplies' },
          { label: '📦 Received 15 Laptops', text: 'I had received 15 laptops for PO-1001' },
          { label: '🔍 Check Invoice INV-1001', text: 'check invoice INV-1001 how many received how many left' },
          { label: '✅ Approve Invoice INV-1001', text: 'approve invoice INV-1001' }
        ]
      : []),
    { label: '🧹 Clear Chat', text: 'clear chat' }
  ];

  return (
    <>
      {/* Floating Chatbot Launcher Icon in Right Bottom (Opens chat when clicked) */}
      {!isOpen && (
        <button
          type="button"
          className="chat-floating-launcher"
          onClick={onToggle}
          title="Open AI ERP Copilot"
        >
          <span className="launcher-avatar">🤖</span>
          <div style={{ textAlign: 'left' }}>
            <div className="launcher-text">AI Copilot</div>
            <small style={{ fontSize: '9px', opacity: 0.85, display: 'block', marginTop: '-2px' }}>
              ● Live Inference
            </small>
          </div>
          <span className={`launcher-role-badge role-tag ${role === 'ADMIN' ? 'role-tag-admin' : role === 'PURCHASER' ? 'role-tag-purchaser' : 'role-tag-warehouse'}`}>
            {role === 'ADMIN' ? 'ADMIN' : role === 'PURCHASER' ? 'PURCHASER' : role === 'WAREHOUSE' ? 'WAREHOUSE' : 'REVIEWER'}
          </span>
        </button>
      )}

      {/* Docked Chatbot Panel (Right Side by default, with Left/Right toggle) */}
      <aside className={`chat-panel dock-${dockPosition} ${!isOpen ? 'collapsed' : ''}`}>
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-main">
            <div className="chat-avatar-badge">
              <span>🤖</span>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <h3 className="chat-title">AI ERP Copilot</h3>
                <span className="live-ai-pill">● Groq Live</span>
              </div>
              <p className="chat-subtitle">
                {role === 'PURCHASER' ? 'Procurement & Orders' : role === 'WAREHOUSE' ? 'Inbound Dock Logistics' : role === 'REVIEWER' ? 'Audit & Approvals' : 'Full ERP Operations'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Dock Position Switcher: Left / Right */}
            <button
              type="button"
              className="chat-toggle-btn"
              onClick={toggleDockPosition}
              title={`Dock panel to ${dockPosition === 'right' ? 'Left' : 'Right'} side`}
            >
              {dockPosition === 'right' ? '⇋ Dock Left' : '⇋ Dock Right'}
            </button>

            {/* Minimize button */}
            <button
              type="button"
              className="chat-toggle-btn"
              onClick={onToggle}
              title="Minimize to bottom-right icon"
            >
              ✕ Minimize
            </button>
          </div>
        </div>

        {/* Active User Information (Top Menu of All Users Removed) */}
        <div className="chat-user-bar">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>User:</span>
              <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>{userName}</strong>
            </div>
            <span className={`role-tag ${role === 'ADMIN' ? 'role-tag-admin' : role === 'PURCHASER' ? 'role-tag-purchaser' : 'role-tag-warehouse'}`}>
              {role === 'ADMIN' ? '👑 ADMIN' : role === 'PURCHASER' ? '🛒 PURCHASER' : role === 'WAREHOUSE' ? '📦 WAREHOUSE' : '🔍 REVIEWER'}
            </span>
          </div>
        </div>

        {/* Role Capability Alert */}
        <div className="chat-capability-banner">
          {role === 'PURCHASER' && (
            <span>
              🛒 <b>Purchaser Perspective:</b> Create purchase orders (*"buy 20 laptops"*). Dock receiving is logged by Warehouse.
            </span>
          )}
          {role === 'WAREHOUSE' && (
            <span>
              📦 <b>Warehouse Perspective:</b> Record dock receipts (*"I had received 15 laptops"*). Orders are placed by Purchaser.
            </span>
          )}
          {role === 'REVIEWER' && (
            <span>
              🔍 <b>Reviewer Perspective:</b> Check invoice receiving (*"check invoice INV-1001"*) & approve (*"approve invoice"*).
            </span>
          )}
          {role === 'ADMIN' && (
            <span>
              👑 <b>Admin Perspective:</b> Full authority across buying, dock delivery receiving, and invoice approvals.
            </span>
          )}
        </div>

        {/* Message Feed */}
        <div className="chat-messages-container">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`chat-message-row ${m.sender === 'user' ? 'user-row' : 'bot-row'}`}
            >
              {m.sender === 'bot' && (
                <div className="bot-avatar-icon">🤖</div>
              )}

              <div className={`chat-bubble ${m.sender === 'user' ? 'user-bubble' : 'bot-bubble'}`}>
                {m.sender === 'user' && (
                  <div className="user-bubble-header">
                    <span>{m.userName}</span>
                    <span className="user-bubble-role">{m.userRole}</span>
                  </div>
                )}

                <div className="chat-bubble-content">
                  {formatText(m.text)}
                </div>

                {/* Interactive Card: PO Created */}
                {m.intent === 'CREATE_PO' && m.data && (
                  <div className="action-result-card po-card">
                    <div className="action-card-header">
                      <span className="action-card-title">📦 Purchase Order Generated</span>
                      <span className="badge matched">OPEN</span>
                    </div>
                    <div className="action-card-grid">
                      <div><small>PO Number:</small> <b>{m.data.poNumber}</b></div>
                      <div><small>Vendor:</small> <b>{m.data.vendor}</b></div>
                      <div><small>Items:</small> <b>{m.data.quantity}x {m.data.itemName}</b></div>
                      <div><small>Total Value:</small> <b>₹{Number(m.data.totalAmount).toLocaleString('en-IN')}</b></div>
                    </div>
                    <div className="action-card-footer">
                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        Linked Invoice: <code>{m.data.invoiceNumber}</code> (BLOCKED)
                      </span>
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={() => navigate('/purchase-orders')}
                      >
                        View in POs ➜
                      </button>
                    </div>
                  </div>
                )}

                {/* Interactive Card: Delivery & GRN Recorded */}
                {m.intent === 'RECORD_DELIVERY' && m.data && (
                  <div className="action-result-card delivery-card">
                    <div className="action-card-header">
                      <span className="action-card-title">🚚 Inbound Delivery & GRN Logged</span>
                      <span className="badge approved">ACCEPTED</span>
                    </div>
                    <div className="action-card-grid">
                      <div><small>Delivery Slip:</small> <b>{m.data.deliveryNumber}</b></div>
                      <div><small>GRN Number:</small> <b>{m.data.grnNumber}</b></div>
                      <div><small>Linked PO:</small> <b>{m.data.poNumber}</b></div>
                      <div><small>Delivered:</small> <b>{m.data.quantity}x {m.data.itemName}</b></div>
                    </div>
                    {m.data.fulfillment && (
                      <div style={{ marginTop: '8px', fontSize: '11px', background: '#f0fdf4', padding: '6px 8px', borderRadius: '6px' }}>
                        <b>Fulfillment Status:</b> {m.data.fulfillment.totalAccepted} / {m.data.fulfillment.totalOrdered || m.data.fulfillment.orderedQty} units accepted
                        ({m.data.fulfillment.isFullyDelivered ? '100% Fulfilled' : 'Partial Delivery'})
                      </div>
                    )}
                    <div className="action-card-footer" style={{ marginTop: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
                        ✓ 3-Way Reconciliation Unblocked
                      </span>
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={() => navigate('/deliveries')}
                      >
                        View in Deliveries ➜
                      </button>
                    </div>
                  </div>
                )}

                {/* Interactive Card: Check Invoice Status & Issues */}
                {m.intent === 'CHECK_INVOICE' && m.data && (
                  <div className="action-result-card invoice-check-card">
                    <div className="action-card-header">
                      <span className="action-card-title">📄 Invoice Receiving & Quantities</span>
                      <span className={`badge ${m.data.status?.toLowerCase()}`}>{m.data.status}</span>
                    </div>
                    <div className="action-card-grid">
                      <div><small>Invoice #:</small> <b>{m.data.invoiceNumber}</b></div>
                      <div><small>Linked PO:</small> <b>{m.data.poNumber || 'None'}</b></div>
                      <div><small>Vendor:</small> <b>{m.data.vendor}</b></div>
                      <div><small>Total Value:</small> <b>₹{Number(m.data.totalAmount).toLocaleString('en-IN')}</b></div>
                    </div>

                    {/* Quantities Breakdown: Received vs Left */}
                    <div style={{ marginTop: '8px', background: '#ffffff', borderRadius: '6px', border: '1px solid var(--line)', padding: '8px' }}>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: '6px' }}>
                        Goods Quantity Breakdown:
                      </div>
                      {m.data.breakdown?.map((b, bi) => (
                        <div key={bi} style={{ fontSize: '11px', marginBottom: '6px', paddingBottom: '6px', borderBottom: bi < m.data.breakdown.length - 1 ? '1px dashed #edf2ef' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                            <span>{b.itemName}</span>
                            <span>Invoiced: {b.invoicedQty} units</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginTop: '4px', fontSize: '10px' }}>
                            <div style={{ background: '#f8faf9', padding: '3px 5px', borderRadius: '4px' }}>
                              <span style={{ color: 'var(--muted)' }}>Ordered:</span> <b>{b.orderedQty}</b>
                            </div>
                            <div style={{ background: '#ecfdf5', color: '#065f46', padding: '3px 5px', borderRadius: '4px' }}>
                              <span>Received:</span> <b>{b.receivedQty}</b>
                            </div>
                            <div style={{ background: b.leftQty > 0 ? '#fffbeb' : '#f0fdf4', color: b.leftQty > 0 ? '#b45309' : '#15803d', padding: '3px 5px', borderRadius: '4px' }}>
                              <span>Left:</span> <b>{b.leftQty}</b>
                            </div>
                          </div>
                          {b.excessQty > 0 && (
                            <div style={{ fontSize: '10px', color: '#7c3aed', marginTop: '3px' }}>
                              Surplus over PO: +{b.excessQty} units
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Issues detected */}
                    <div style={{ marginTop: '8px', padding: '6px 8px', borderRadius: '6px', background: m.data.hasIssues ? '#fef2f2' : '#f0fdf4', border: `1px solid ${m.data.hasIssues ? '#fecaca' : '#bbf7d0'}`, fontSize: '11px' }}>
                      {m.data.hasIssues ? (
                        <div>
                          <b style={{ color: '#b91c1c' }}>⚠️ Issues in Receiving:</b>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '16px', color: '#7f1d1d' }}>
                            {m.data.issues?.map((iss, ii) => (
                              <li key={ii}>{iss}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div style={{ color: '#166534', fontWeight: 600 }}>
                          ✓ Clean 3-Way Match: Zero discrepancies. Everything is right!
                        </div>
                      )}
                    </div>

                    {/* Action button: 1-Click Approve Invoice */}
                    <div className="action-card-footer" style={{ marginTop: '10px' }}>
                      <button
                        type="button"
                        className="btn-card-action"
                        style={{ background: '#6c7c76' }}
                        onClick={() => navigate(`/invoices/${m.data.invoiceId}`)}
                      >
                        Details ➜
                      </button>

                      {m.data.canApprove && (
                        role === 'REVIEWER' || role === 'ADMIN' ? (
                          <button
                            type="button"
                            className="btn-card-action"
                            style={{ background: '#16a34a' }}
                            onClick={() => handleSend(`approve invoice ${m.data.invoiceNumber}`)}
                          >
                            ✓ Approve Invoice
                          </button>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
                            ⚠️ Requires Reviewer or Admin role to approve
                          </span>
                        )
                      )}

                      {m.data.isAlreadyApproved && (
                        <span style={{ color: '#15803d', fontWeight: 700, fontSize: '11px' }}>
                          ✓ Already Approved
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Interactive Card: Invoice Approved */}
                {m.intent === 'APPROVE_INVOICE' && m.data && (
                  <div className="action-result-card approved-card">
                    <div className="action-card-header">
                      <span className="action-card-title" style={{ color: '#15803d' }}>
                        ✅ Invoice Approved
                      </span>
                      <span className="badge approved">APPROVED</span>
                    </div>
                    <div className="action-card-grid">
                      <div><small>Invoice #:</small> <b>{m.data.invoiceNumber}</b></div>
                      <div><small>Reviewer:</small> <b>{m.data.reviewer}</b></div>
                      <div><small>Decision:</small> <b>APPROVED</b></div>
                      <div><small>Status:</small> <b>Cleared for Payment</b></div>
                    </div>
                    <div className="action-card-footer">
                      <button
                        type="button"
                        className="btn-card-action"
                        onClick={() => navigate('/invoices')}
                      >
                        View in Invoices ➜
                      </button>
                    </div>
                  </div>
                )}

                {/* Interactive Card: Role Denied */}
                {m.roleDenied && (
                  <div className="action-result-card denied-card">
                    <div className="action-card-header">
                      <span className="action-card-title" style={{ color: '#b91c1c' }}>
                        ⛔ Role Permission Denied
                      </span>
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#7f1d1d' }}>
                      Required Role: <b>{m.requiredRole || (m.actionAttempted === 'CREATE_PO' ? 'PURCHASER or ADMIN' : m.actionAttempted === 'APPROVE_INVOICE' ? 'REVIEWER or ADMIN' : 'WAREHOUSE or ADMIN')}</b>. Please sign in with an authorized account to proceed.
                    </p>
                  </div>
                )}

                <div className="chat-bubble-time">{m.timestamp}</div>
              </div>
            </div>
          ))}

          {/* Thinking Dot Indicator */}
          {loading && (
            <div className="chat-message-row bot-row">
              <div className="bot-avatar-icon">🤖</div>
              <div className="chat-bubble bot-bubble thinking-bubble">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <small style={{ marginLeft: '8px', color: 'var(--muted)', fontSize: '11px' }}>
                  Processing command with Groq LPU…
                </small>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="chat-chips-container">
          <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 700, marginRight: '4px' }}>
            Try:
          </span>
          {promptSuggestions.map((chip, idx) => (
            <button
              key={idx}
              type="button"
              className="chat-chip"
              onClick={() => handleSend(chip.text)}
              disabled={loading}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Input Footer */}
        <div className="chat-input-footer">
          <div className="chat-input-wrapper">
            <textarea
              className="chat-textarea"
              rows={2}
              placeholder={
                role === 'PURCHASER'
                  ? "Type 'buy 20 laptops from ABC Supplies'…"
                  : role === 'WAREHOUSE'
                  ? "Type 'I had received 15 laptops'…"
                  : role === 'REVIEWER'
                  ? "Type 'check invoice INV-1001' or 'approve invoice'…"
                  : "Type 'buy 20 laptops', 'received 10 laptops', or 'check invoice'…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="button"
              className="chat-send-btn"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              title="Send command"
            >
              <span>➤</span>
            </button>
          </div>
          <div className="chat-input-hint">
            <span>Press <b>Enter</b> to send · <b>Shift+Enter</b> for newline</span>
            <button
              type="button"
              className="chat-clear-link"
              onClick={executeClearChat}
              title="Delete all chat history up to this point for your account"
            >
              🗑 Clear Chat
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
