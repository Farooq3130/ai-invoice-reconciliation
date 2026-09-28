import express from 'express';
import cors from 'cors';
import multer from 'multer';
import XLSX from 'xlsx';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { db } from './config/db.js';
import { processInvoice, autoGenerateInvoiceForPO } from './services/orchestratorService.js';
import { checkGroqStatus } from './services/groqService.js';
import { deliveryGrnAgent } from './agents/deliveryGrnAgent.js';
import { handleChatMessage } from './services/chatbotService.js';

const app = express();
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper for wrapping async express routes
const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(`[API Error] ${req.method} ${req.url}:`, err);
    res.status(400).json({ error: err.message || 'Internal error' });
  });

// ----------------------------------------------------------------------------
// Health & AI Status
// ----------------------------------------------------------------------------
app.get('/api/health', asyncRoute(async (req, res) => {
  await db.query('SELECT 1');
  const aiStatus = await checkGroqStatus();
  res.json({
    ok: true,
    db: 'CONNECTED',
    aiStatus,
    demoMode: process.env.DEMO_MODE === 'true',
    activeModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    timestamp: new Date().toISOString()
  });
}));

// ----------------------------------------------------------------------------
// Autonomous AI Copilot / Chatbot Endpoint
// ----------------------------------------------------------------------------
app.post('/api/chat', asyncRoute(async (req, res) => {
  const { message, user } = req.body;
  const reply = await handleChatMessage({ message, user });
  res.json(reply);
}));

// ----------------------------------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------------------------------
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email) throw new Error('Email is required');

  const normalizedEmail = email.trim().toLowerCase();
  const [users] = await db.query('SELECT * FROM users WHERE LOWER(email) = ?', [normalizedEmail]);

  let user = users[0];
  if (!user) {
    if (normalizedEmail.includes('admin')) {
      const [ins] = await db.query(
        "INSERT INTO users(name, email, role) VALUES('Alex Admin', ?, 'ADMIN')",
        [normalizedEmail]
      );
      user = { id: ins.insertId, name: 'Alex Admin', email: normalizedEmail, role: 'ADMIN' };
    } else if (normalizedEmail.includes('purchas')) {
      const [ins] = await db.query(
        "INSERT INTO users(name, email, role) VALUES('Peter Purchaser', ?, 'PURCHASER')",
        [normalizedEmail]
      );
      user = { id: ins.insertId, name: 'Peter Purchaser', email: normalizedEmail, role: 'PURCHASER' };
    } else if (normalizedEmail.includes('warehouse')) {
      const [ins] = await db.query(
        "INSERT INTO users(name, email, role) VALUES('Vikram Warehouse', ?, 'WAREHOUSE')",
        [normalizedEmail]
      );
      user = { id: ins.insertId, name: 'Vikram Warehouse', email: normalizedEmail, role: 'WAREHOUSE' };
    } else {
      const name = email.split('@')[0].replace('.', ' ');
      const role = normalizedEmail === 'priya@example.com' ? 'ADMIN' : 'REVIEWER';
      const [ins] = await db.query(
        'INSERT INTO users(name, email, role) VALUES(?, ?, ?)',
        [name, normalizedEmail, role]
      );
      user = { id: ins.insertId, name, email: normalizedEmail, role };
    }
  }

  // Audit login
  await db.query(
    'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
    ['USER_LOGIN', 'user', String(user.id), `User ${user.email} logged in`]
  );

  res.json({
    token: 'jwt-token-session-' + Date.now(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const [users] = await db.query('SELECT id, name, email, role FROM users LIMIT 1');
  res.json(users[0] || { id: 1, name: 'Priya Reviewer', email: 'priya@example.com', role: 'REVIEWER' });
}));

app.get('/api/auth/users', asyncRoute(async (req, res) => {
  const [users] = await db.query('SELECT id, name, email, role, created_at FROM users');
  res.json(users);
}));

// ----------------------------------------------------------------------------
// Dashboard Stats
// ----------------------------------------------------------------------------
app.get('/api/dashboard/stats', asyncRoute(async (req, res) => {
  const [[s]] = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'UPLOADED') AS uploaded,
      SUM(status = 'PROCESSING') AS processing,
      SUM(status = 'MATCHED') AS matched,
      SUM(status = 'PENDING_REVIEW') AS pending_approval,
      SUM(status = 'APPROVED') AS approved,
      SUM(status = 'REJECTED') AS rejected,
      COALESCE(SUM(total_amount), 0) AS total_value,
      COALESCE(SUM(CASE WHEN status IN ('MATCHED', 'APPROVED') THEN total_amount ELSE 0 END), 0) AS processed_value
    FROM invoices
  `);

  const [[excCount]] = await db.query(
    "SELECT COUNT(*) AS count FROM mismatch_exceptions WHERE status = 'PENDING_REVIEW'"
  );

  res.json({
    ...s,
    mismatched: s.pending_approval || 0,
    pendingExceptions: excCount.count
  });
}));

// ----------------------------------------------------------------------------
// Invoices Endpoints
// ----------------------------------------------------------------------------
app.get('/api/invoices', asyncRoute(async (req, res) => {
  const { search, status } = req.query;
  let sql = `
    SELECT
      i.*,
      v.name AS vendor,
      v.code AS vendor_code,
      pr.status AS reconciliation_status,
      (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS item_count
    FROM invoices i
    JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN processing_results pr ON pr.invoice_id = i.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'ALL') {
    sql += ' AND i.status = ?';
    params.push(status);
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    sql += ' AND (i.invoice_number LIKE ? OR i.po_number LIKE ? OR v.name LIKE ?)';
    params.push(q, q, q);
  }

  sql += ' ORDER BY i.created_at DESC';

  const [rows] = await db.query(sql, params);
  res.json(rows);
}));

app.get('/api/invoices/:id', asyncRoute(async (req, res) => {
  const [[invoice]] = await db.query(
    `SELECT i.*, v.name AS vendor, v.code AS vendor_code
     FROM invoices i
     JOIN vendors v ON v.id = i.vendor_id
     WHERE i.id = ?`,
    [req.params.id]
  );
  if (!invoice) throw new Error('Invoice not found');

  const [items] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC', [invoice.id]);
  const [[pr]] = await db.query('SELECT * FROM processing_results WHERE invoice_id = ?', [invoice.id]);
  const [logs] = await db.query('SELECT * FROM agent_logs WHERE invoice_id = ? ORDER BY id ASC', [invoice.id]);
  const [[exception]] = await db.query('SELECT * FROM mismatch_exceptions WHERE invoice_id = ? ORDER BY id DESC LIMIT 1', [invoice.id]);
  const [approvals] = await db.query('SELECT * FROM approvals WHERE invoice_id = ? ORDER BY decided_at DESC', [invoice.id]);

  // Fetch linked PO details if PO exists
  let po = null;
  if (invoice.po_number) {
    const [[poRow]] = await db.query(
      `SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id WHERE po.po_number = ?`,
      [invoice.po_number]
    );
    if (poRow) {
      const [poItems] = await db.query('SELECT * FROM purchase_order_items WHERE po_id = ?', [poRow.id]);
      const [deliveries] = await db.query('SELECT * FROM deliveries WHERE po_id = ? ORDER BY delivery_date ASC', [poRow.id]);
      const [grns] = await db.query(
        `SELECT gi.*, g.grn_number, COALESCE(gi.delivery_id, g.delivery_id) AS delivery_id,
                d.delivery_number, COALESCE(d.delivery_date, g.grn_date) AS delivery_date
         FROM grn_items gi
         JOIN grns g ON g.id = gi.grn_id
         LEFT JOIN deliveries d ON d.id = COALESCE(gi.delivery_id, g.delivery_id)
         WHERE g.po_id = ?
         ORDER BY COALESCE(d.delivery_date, g.grn_date) ASC, gi.id ASC`,
        [poRow.id]
      );
      const [returns] = await db.query(
        'SELECT * FROM returns WHERE po_id = ? ORDER BY return_date DESC, id DESC',
        [poRow.id]
      );
      po = { ...poRow, grn_number: grns[0]?.grn_number || null, items: poItems, deliveries, grns, returns };
    }
  }

  res.json({
    ...invoice,
    items,
    po,
    reconciliation: pr ? (typeof pr.result_json === 'string' ? JSON.parse(pr.result_json) : pr.result_json) : null,
    exception: exception || null,
    approvals,
    agentLogs: logs.map(x => ({
      ...x,
      result: typeof x.result_json === 'string' ? JSON.parse(x.result_json) : x.result_json
    }))
  });
}));

app.post('/api/invoices/:id/process', asyncRoute(async (req, res) => {
  const result = await processInvoice(req.params.id);
  res.json(result);
}));

app.get('/api/invoices/:id/reconciliation', asyncRoute(async (req, res) => {
  const [[r]] = await db.query('SELECT * FROM processing_results WHERE invoice_id = ?', [req.params.id]);
  if (!r) throw new Error('Invoice has not been processed');
  const parsed = typeof r.result_json === 'string' ? JSON.parse(r.result_json) : r.result_json;
  res.json({ ...r, result: parsed });
}));

app.post('/api/invoices/upload', upload.single('file'), asyncRoute(async (req, res) => {
  const d = req.body;
  if (!d.invoiceNo || !d.vendor || !d.poNumber || !d.item) {
    throw new Error('invoiceNo, vendor, poNumber and item are required fields.');
  }

  // Verify vendor
  const [[v]] = await db.query('SELECT id FROM vendors WHERE LOWER(name) = LOWER(?)', [d.vendor.trim()]);
  if (!v) {
    throw new Error(`Vendor '${d.vendor}' not found. Please choose a registered vendor (e.g. ABC Supplies, XYZ Displays, TechSource India).`);
  }

  const invoiceDate = d.invoiceDate ? new Date(d.invoiceDate) : new Date();
  const quantity = Number(d.quantity);
  const unitPrice = Number(d.unitPrice);
  const lineTotal = quantity * unitPrice;
  const taxAmount = Number(d.tax || lineTotal * 0.18);
  const totalAmount = Number(d.total || lineTotal + taxAmount);

  const [r] = await db.query(
    `INSERT INTO invoices(invoice_number, vendor_id, po_number, invoice_date, tax_amount, total_amount, status, source_file)
     VALUES (?, ?, ?, ?, ?, ?, 'UPLOADED', ?)`,
    [d.invoiceNo.trim(), v.id, d.poNumber.trim(), invoiceDate, taxAmount, totalAmount, req.file?.filename || null]
  );

  await db.query(
    `INSERT INTO invoice_items(invoice_id, item_name, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?)`,
    [r.insertId, d.item.trim(), quantity, unitPrice, lineTotal]
  );

  // Record audit log
  await db.query(
    'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
    ['INVOICE_UPLOAD', 'invoice', String(r.insertId), `Invoice ${d.invoiceNo} created for PO ${d.poNumber}`]
  );

  res.status(201).json({
    id: r.insertId,
    invoiceNumber: d.invoiceNo,
    message: 'Invoice created successfully'
  });
}));

// ----------------------------------------------------------------------------
// Bulk Upload
// ----------------------------------------------------------------------------
app.post('/api/invoices/bulk-upload', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw new Error('An Excel (.xlsx/.xls) or CSV (.csv) file is required.');

  const wb = XLSX.readFile(req.file.path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!rows.length) throw new Error('The uploaded file contains no data rows.');

  const batchNo = `BATCH-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const [b] = await db.query(
    'INSERT INTO processing_batches(batch_number, total_count, status) VALUES (?, ?, ?)',
    [batchNo, rows.length, 'PROCESSING']
  );

  const createdIds = [];
  const failedRows = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const x = rows[idx];
    try {
      if (!x.invoiceNo || !x.vendor || !x.poNumber || !x.item || !x.quantity || !x.unitPrice) {
        throw new Error(`Row ${idx + 1} is missing required fields (invoiceNo, vendor, poNumber, item, quantity, unitPrice)`);
      }

      const [[v]] = await db.query('SELECT id FROM vendors WHERE LOWER(name) = LOWER(?)', [String(x.vendor).trim()]);
      if (!v) throw new Error(`Row ${idx + 1}: Unknown vendor '${x.vendor}'`);

      const qty = Number(x.quantity);
      const price = Number(x.unitPrice);
      const lineTotal = qty * price;
      const tax = Number(x.tax !== '' ? x.tax : lineTotal * 0.18);
      const total = Number(x.total !== '' ? x.total : lineTotal + tax);

      const [i] = await db.query(
        `INSERT INTO invoices(invoice_number, vendor_id, po_number, invoice_date, tax_amount, total_amount, status, batch_id)
         VALUES (?, ?, ?, NOW(), ?, ?, 'UPLOADED', ?)`,
        [String(x.invoiceNo).trim(), v.id, String(x.poNumber).trim(), tax, total, b.insertId]
      );

      await db.query(
        `INSERT INTO invoice_items(invoice_id, item_name, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
        [i.insertId, String(x.item).trim(), qty, price, lineTotal]
      );

      createdIds.push(i.insertId);
    } catch (e) {
      failedRows.push({ rowNumber: idx + 1, data: x, error: e.message });
      await db.query(
        'INSERT INTO processing_results(batch_id, status, result_json, processed_at) VALUES (?, ?, ?, NOW())',
        [b.insertId, 'FAILED', JSON.stringify({ row: x, error: e.message })]
      );
    }
  }

  // Process all created invoices through agent orchestrator
  for (const id of createdIds) {
    try {
      await processInvoice(id);
    } catch (err) {
      console.error(`Batch processing invoice ${id} failed:`, err.message);
    }
  }

  await db.query(
    "UPDATE processing_batches SET processed_count = ?, status = 'COMPLETED' WHERE id = ?",
    [createdIds.length, b.insertId]
  );

  // Record audit
  await db.query(
    'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
    [
      'BATCH_UPLOAD',
      'batch',
      String(b.insertId),
      `Batch ${batchNo}: ${createdIds.length} succeeded, ${failedRows.length} failed`
    ]
  );

  res.status(201).json({
    batchId: b.insertId,
    batchNumber: batchNo,
    total: rows.length,
    processed: createdIds.length,
    failed: failedRows.length,
    failedRows
  });
}));

// Endpoint to generate / download sample CSV template
app.get('/api/invoices/template/sample', (req, res) => {
  const sampleData = [
    'invoiceNo,vendor,poNumber,item,quantity,unitPrice,tax,total',
    'INV-BATCH-01,ABC Supplies,PO-1001,Laptop,100,50000,900000,5900000',
    'INV-BATCH-02,XYZ Displays,PO-1002,Monitor,50,20000,180000,1180000',
    'INV-BATCH-03,TechSource India,PO-1003,Printer,30,25000,135000,885000'
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="invoice_reconciliation_template.csv"');
  res.send(sampleData);
});

// ----------------------------------------------------------------------------
// Batches
// ----------------------------------------------------------------------------
app.get('/api/batches', asyncRoute(async (req, res) => {
  const [r] = await db.query('SELECT * FROM processing_batches ORDER BY created_at DESC');
  res.json(r);
}));

app.get('/api/batches/:id', asyncRoute(async (req, res) => {
  const [[b]] = await db.query('SELECT * FROM processing_batches WHERE id = ?', [req.params.id]);
  if (!b) throw new Error('Batch not found');
  const [invoices] = await db.query(
    'SELECT id, invoice_number, status, total_amount, po_number FROM invoices WHERE batch_id = ?',
    [req.params.id]
  );
  const [failedRows] = await db.query(
    "SELECT result_json FROM processing_results WHERE batch_id = ? AND status = 'FAILED'",
    [req.params.id]
  );
  res.json({
    ...b,
    invoices,
    failedRows: failedRows.map(f => (typeof f.result_json === 'string' ? JSON.parse(f.result_json) : f.result_json))
  });
}));

// ----------------------------------------------------------------------------
// Purchase Orders & Deliveries
// ----------------------------------------------------------------------------
app.get('/api/vendors', asyncRoute(async (req, res) => {
  const [vendors] = await db.query('SELECT * FROM vendors ORDER BY name ASC');
  res.json(vendors);
}));

app.get('/api/purchase-orders', asyncRoute(async (req, res) => {
  const [pos] = await db.query(`
    SELECT po.*, v.name AS vendor, v.code AS vendor_code,
           (SELECT g.grn_number FROM grns g WHERE g.po_id = po.id LIMIT 1) AS grn_number,
           (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS item_count,
           (SELECT COUNT(*) FROM deliveries WHERE po_id = po.id) AS delivery_count,
           COALESCE((
             SELECT SUM(gi.accepted_quantity)
             FROM grn_items gi
             JOIN grns g ON g.id = gi.grn_id
             WHERE g.po_id = po.id
           ), 0) AS total_accepted_quantity,
           COALESCE((
             SELECT SUM(poi.ordered_quantity)
             FROM purchase_order_items poi
             WHERE poi.po_id = po.id
           ), 0) AS total_ordered_quantity,
           COALESCE((
             SELECT SUM(r.quantity)
             FROM returns r
             WHERE r.po_id = po.id
           ), 0) AS total_returned_quantity
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    ORDER BY po.id DESC
  `);
  res.json(pos);
}));

// Create a new Purchase Order only
app.post('/api/purchase-orders', asyncRoute(async (req, res) => {
  const poNumber = req.body.poNumber || req.body.po_number;
  const vendor = req.body.vendor;
  const orderDate = req.body.orderDate || req.body.order_date;
  const items = req.body.items;
  if (!poNumber || !poNumber.trim()) throw new Error('PO Number is required');
  if (!vendor || !vendor.trim()) throw new Error('Vendor is required');
  if (!items || !items.length) throw new Error('At least one line item is required');

  // Find or create vendor
  let [[v]] = await db.query('SELECT id, name FROM vendors WHERE LOWER(name) = LOWER(?)', [vendor.trim()]);
  if (!v) {
    const code = vendor.trim().slice(0, 3).toUpperCase() + Math.floor(Math.random() * 89 + 10);
    const [vIns] = await db.query('INSERT INTO vendors(name, code) VALUES(?, ?)', [vendor.trim(), code]);
    v = { id: vIns.insertId, name: vendor.trim() };
  }

  // Calculate line items and total amount
  let calculatedTotal = 0;
  const processedItems = items.map(it => {
    const qty = Number(it.orderedQuantity || it.ordered_quantity || it.quantity || 0);
    const price = Number(it.unitPrice || it.unit_price || 0);
    if (qty <= 0) throw new Error(`Invalid quantity for item '${it.itemName || it.item_name}'`);
    if (price <= 0) throw new Error(`Invalid unit price for item '${it.itemName || it.item_name}'`);
    const line = qty * price;
    calculatedTotal += line;
    return {
      itemName: String(it.itemName || it.item_name).trim(),
      orderedQuantity: qty,
      unitPrice: price,
      lineTotal: line
    };
  });

  const finalOrderDate = orderDate ? new Date(orderDate) : new Date();

  const [poIns] = await db.query(
    'INSERT INTO purchase_orders(po_number, vendor_id, status, order_date, total_amount) VALUES(?, ?, ?, ?, ?)',
    [poNumber.trim().toUpperCase(), v.id, 'OPEN', finalOrderDate, calculatedTotal]
  );
  const poId = poIns.insertId;

  for (const it of processedItems) {
    await db.query(
      'INSERT INTO purchase_order_items(po_id, item_name, ordered_quantity, unit_price) VALUES(?, ?, ?, ?)',
      [poId, it.itemName, it.orderedQuantity, it.unitPrice]
    );
  }

  // Pre-generate invoice in BLOCKED status (access locked until warehouse delivers goods)
  let preGeneratedInvoice = null;
  try {
    const invNo = `INV-${poNumber.trim().toUpperCase().replace(/^PO-?/, '')}`;
    const taxAmount = Math.round(calculatedTotal * 0.18);
    const totalAmount = calculatedTotal + taxAmount;

    const [invIns] = await db.query(
      `INSERT INTO invoices(invoice_number, vendor_id, po_number, invoice_date, tax_amount, total_amount, status)
       VALUES (?, ?, ?, NOW(), ?, ?, 'BLOCKED')`,
      [invNo, v.id, poNumber.trim().toUpperCase(), taxAmount, totalAmount]
    );

    for (const it of processedItems) {
      await db.query(
        `INSERT INTO invoice_items(invoice_id, item_name, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
        [invIns.insertId, it.itemName, it.orderedQuantity, it.unitPrice, it.lineTotal]
      );
    }

    await db.query(
      'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
      [
        'INVOICE_CREATED_BLOCKED',
        'invoice',
        String(invIns.insertId),
        `Invoice ${invNo} pre-generated in BLOCKED status for ${poNumber.trim().toUpperCase()} pending warehouse dock delivery`
      ]
    );

    preGeneratedInvoice = {
      id: invIns.insertId,
      invoiceNumber: invNo,
      status: 'BLOCKED'
    };
  } catch (invErr) {
    console.warn('Pre-generating invoice notice:', invErr.message);
  }

  // Record audit log
  await db.query(
    'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
    [
      'PO_CREATED',
      'purchase_order',
      String(poId),
      `Purchase Order ${poNumber.trim().toUpperCase()} created for ${v.name} (${processedItems.length} items, total: ₹${calculatedTotal.toLocaleString()})`
    ]
  );

  res.status(201).json({
    success: true,
    message: `Purchase Order ${poNumber.trim().toUpperCase()} created successfully`,
    poId,
    poNumber: poNumber.trim().toUpperCase(),
    vendor: v.name,
    itemCount: processedItems.length,
    totalAmount: calculatedTotal,
    invoice: preGeneratedInvoice
  });
}));

// Log Incoming Delivery directly and trigger Autonomous Agent to match PO & generate GRN
app.post('/api/deliveries', asyncRoute(async (req, res) => {
  const deliveryNumber = req.body.deliveryNumber || req.body.delivery_number;
  const deliveryDate = req.body.deliveryDate || req.body.delivery_date;
  const poNumber = req.body.poNumber || req.body.po_number;
  const vendor = req.body.vendor;
  const items = req.body.items;
  const notes = req.body.notes;
  if (!items || !items.length) {
    throw new Error('Delivery must contain at least one delivered item with quantity.');
  }

  const result = await deliveryGrnAgent.matchDeliveryAndGenerateGRN({
    deliveryNumber,
    deliveryDate,
    poNumber,
    vendor,
    items: items.map(i => ({
      item_name: i.itemName || i.item_name,
      quantity: Number(i.quantity || i.deliveredQuantity || i.delivered_quantity)
    })),
    notes
  });

  // When deliveries arrive, unblock the pre-generated BLOCKED invoice and execute 3-way reconciliation
  let autoInvoice = null;
  try {
    const [[existingInv]] = await db.query(
      'SELECT id, invoice_number, status FROM invoices WHERE po_number = ? ORDER BY id DESC LIMIT 1',
      [result.poNumber]
    );
    if (existingInv) {
      if (existingInv.status === 'BLOCKED') {
        // Unblock invoice and process 3-way reconciliation!
        autoInvoice = await processInvoice(existingInv.id);
      } else if (result.fulfillment?.isFullyDelivered) {
        // Re-process with final lot
        autoInvoice = await processInvoice(existingInv.id);
      }
    } else if (result.fulfillment?.totalAccepted > 0) {
      autoInvoice = await autoGenerateInvoiceForPO(result.poNumber);
    }
  } catch (err) {
    console.warn(`[Auto-Invoice] Notice for ${result.poNumber}:`, err.message);
  }

  res.status(201).json({
    ...result,
    autoInvoice
  });
}));

// On-demand: Auto-generate invoice for a PO and run 3-way reconciliation immediately
app.post('/api/purchase-orders/:poNumber/auto-invoice', asyncRoute(async (req, res) => {
  const result = await autoGenerateInvoiceForPO(req.params.poNumber, {
    mode: req.body.mode || 'auto'
  });
  res.status(201).json(result);
}));

// Per-PO delivery tracker: Check how many deliveries have been done per PO, with agent GRNs
app.get('/api/purchase-orders/:poNumber/delivery-tracker', asyncRoute(async (req, res) => {
  const tracker = await deliveryGrnAgent.getDeliveryTrackerForPO(req.params.poNumber);
  res.json(tracker);
}));

// Return excess received items back to vendor (RTV)
app.post('/api/purchase-orders/:poNumber/return-excess', asyncRoute(async (req, res) => {
  const result = await deliveryGrnAgent.returnExcessItems({
    poNumber: req.params.poNumber,
    itemName: req.body.itemName,
    quantity: req.body.quantity,
    reason: req.body.reason,
    notes: req.body.notes,
    reviewer: req.body.reviewer
  });
  res.json(result);
}));

// Return excess items via invoice context
app.post('/api/invoices/:id/return-excess', asyncRoute(async (req, res) => {
  const [[invoice]] = await db.query('SELECT id, po_number FROM invoices WHERE id = ?', [req.params.id]);
  if (!invoice || !invoice.po_number) throw new Error('Invoice not found or has no linked Purchase Order.');
  const result = await deliveryGrnAgent.returnExcessItems({
    poNumber: invoice.po_number,
    invoiceId: invoice.id,
    itemName: req.body.itemName,
    quantity: req.body.quantity,
    reason: req.body.reason,
    notes: req.body.notes,
    reviewer: req.body.reviewer
  });
  res.json(result);
}));

// Fetch RTV returns for a PO
app.get('/api/purchase-orders/:poNumber/returns', asyncRoute(async (req, res) => {
  const [pos] = await db.query('SELECT id FROM purchase_orders WHERE po_number = ?', [req.params.poNumber]);
  if (!pos[0]) throw new Error('PO not found');
  const [returns] = await db.query(
    'SELECT * FROM returns WHERE po_id = ? ORDER BY return_date DESC, id DESC',
    [pos[0].id]
  );
  res.json(returns);
}));

// Consolidated scorecard of deliveries per PO across the entire system
app.get('/api/deliveries/summary-by-po', asyncRoute(async (req, res) => {
  const [pos] = await db.query('SELECT po_number FROM purchase_orders ORDER BY id DESC');
  const trackers = [];
  for (const p of pos) {
    try {
      const t = await deliveryGrnAgent.getDeliveryTrackerForPO(p.po_number);
      trackers.push(t);
    } catch (e) {
      console.warn(`Tracker failed for PO ${p.po_number}:`, e.message);
    }
  }
  res.json(trackers);
}));

app.get('/api/purchase-orders/:poNumber', asyncRoute(async (req, res) => {
  const [[po]] = await db.query(
    `SELECT po.*, v.name AS vendor,
            (SELECT g.grn_number FROM grns g WHERE g.po_id = po.id LIMIT 1) AS grn_number
     FROM purchase_orders po
     JOIN vendors v ON v.id = po.vendor_id
     WHERE po.po_number = ?`,
    [req.params.poNumber]
  );
  if (!po) throw new Error('PO not found');
  const [items] = await db.query('SELECT * FROM purchase_order_items WHERE po_id = ?', [po.id]);
  res.json({ ...po, items });
}));

app.get('/api/purchase-orders/:poNumber/deliveries', asyncRoute(async (req, res) => {
  const [r] = await db.query(
    `SELECT d.* FROM deliveries d JOIN purchase_orders p ON p.id = d.po_id WHERE p.po_number = ? ORDER BY d.delivery_date ASC`,
    [req.params.poNumber]
  );
  res.json(r);
}));

app.get('/api/purchase-orders/:poNumber/grns', asyncRoute(async (req, res) => {
  const [r] = await db.query(
    `SELECT g.*, gi.item_name, gi.accepted_quantity, d.delivery_number, d.delivery_date
     FROM grns g
     JOIN grn_items gi ON gi.grn_id = g.id
     LEFT JOIN deliveries d ON d.id = COALESCE(gi.delivery_id, g.delivery_id)
     JOIN purchase_orders p ON p.id = g.po_id
     WHERE p.po_number = ?
     ORDER BY g.grn_date ASC, gi.id ASC`,
    [req.params.poNumber]
  );
  res.json(r);
}));

app.get('/api/deliveries', asyncRoute(async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      d.id AS delivery_id,
      d.delivery_number,
      d.delivery_date,
      d.status AS delivery_status,
      p.po_number,
      v.name AS vendor,
      COALESCE(g.grn_number, (SELECT g2.grn_number FROM grns g2 WHERE g2.po_id = p.id LIMIT 1)) AS grn_number,
      COALESCE(g.grn_date, (SELECT g2.grn_date FROM grns g2 WHERE g2.po_id = p.id LIMIT 1)) AS grn_date,
      gi.item_name,
      gi.accepted_quantity
    FROM deliveries d
    JOIN purchase_orders p ON p.id = d.po_id
    JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN grns g ON g.po_id = p.id
    LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.delivery_id = d.id
    ORDER BY d.delivery_date DESC, d.id DESC
  `);
  res.json(rows);
}));

// ----------------------------------------------------------------------------
// Exceptions & Approval Queue
// ----------------------------------------------------------------------------
app.get('/api/exceptions', asyncRoute(async (req, res) => {
  const [r] = await db.query(`
    SELECT
      e.*,
      i.invoice_number,
      i.po_number,
      i.total_amount,
      v.name AS vendor
    FROM mismatch_exceptions e
    JOIN invoices i ON i.id = e.invoice_id
    JOIN vendors v ON v.id = i.vendor_id
    WHERE e.status = 'PENDING_REVIEW'
    ORDER BY e.created_at DESC
  `);
  res.json(r);
}));

for (const decision of ['approve', 'reject']) {
  app.post(
    `/api/invoices/:id/${decision}`,
    asyncRoute(async (req, res) => {
      const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
      const reviewer = req.body.reviewer || 'Priya Reviewer';
      const comment = req.body.comment || `Invoice ${status.toLowerCase()} by reviewer.`;

      await db.query('UPDATE invoices SET status = ? WHERE id = ?', [status, req.params.id]);
      await db.query('UPDATE mismatch_exceptions SET status = ? WHERE invoice_id = ?', [status, req.params.id]);
      await db.query(
        'INSERT INTO approvals(invoice_id, reviewer, decision, comment, decided_at) VALUES (?, ?, ?, ?, NOW())',
        [req.params.id, reviewer, status, comment]
      );
      await db.query(
        'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
        [`INVOICE_${status}`, 'invoice', String(req.params.id), `${status}: ${comment} (Reviewer: ${reviewer})`]
      );

      res.json({
        success: true,
        status,
        invoiceId: req.params.id,
        reviewer,
        comment
      });
    })
  );
}

// ----------------------------------------------------------------------------
// Audit Logs
// ----------------------------------------------------------------------------
app.get('/api/audit-logs', asyncRoute(async (req, res) => {
  const [r] = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
  res.json(r);
}));

// ----------------------------------------------------------------------------
// Demo / Seed Reset Tool
// ----------------------------------------------------------------------------
app.post('/api/system/reset-demo', asyncRoute(async (req, res) => {
  // Clear approvals, exceptions, agent logs, processing results
  await db.query('DELETE FROM approvals');
  await db.query('DELETE FROM mismatch_exceptions');
  await db.query('DELETE FROM agent_logs');
  await db.query('DELETE FROM processing_results');

  // Reset seed invoices 1-10 back to UPLOADED
  await db.query("UPDATE invoices SET status = 'UPLOADED' WHERE id <= 10");

  // Remove any dynamically uploaded test invoices > 10
  await db.query('DELETE FROM invoice_items WHERE invoice_id > 10');
  await db.query('DELETE FROM invoices WHERE id > 10');
  await db.query('DELETE FROM processing_batches');

  await db.query(
    "INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES ('SYSTEM_RESET', 'system', 'all', 'Demo test invoices reset to clean initial state')"
  );

  res.json({
    success: true,
    message: 'Demo invoices reset to clean initial state (UPLOADED).'
  });
}));

// ----------------------------------------------------------------------------
// Global Error Handler
// ----------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[Unhandled Express Error]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AI Invoice Reconciliation API running on http://localhost:${PORT}`);
  console.log(`Live AI Mode: ${process.env.DEMO_MODE === 'false' ? 'ACTIVE (Groq)' : 'DEMO/MOCK'}`);
  console.log(`AI Model: ${process.env.GROQ_MODEL || 'openai/gpt-oss-120b'}`);
});

