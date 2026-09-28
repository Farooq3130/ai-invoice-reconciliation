import { db } from '../config/db.js';
import { invoiceAgent } from '../agents/invoiceAgent.js';
import { purchaseOrderAgent } from '../agents/purchaseOrderAgent.js';
import { deliveryGrnAgent } from '../agents/deliveryGrnAgent.js';
import { reconciliationAgent } from '../agents/reconciliationAgent.js';
import { exceptionAgent } from '../agents/exceptionAgent.js';

const logAgentRun = async (invoiceId, agentName, status, result, startTime) => {
  try {
    await db.query(
      `INSERT INTO agent_logs(invoice_id, agent_name, status, result_json, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [invoiceId, agentName, status, JSON.stringify(result), startTime]
    );
  } catch (err) {
    console.error(`Failed to log agent run for ${agentName}:`, err.message);
  }
};

export async function processInvoice(id) {
  // 1. Fetch invoice and line items
  const [[invoice]] = await db.query(
    `SELECT i.*, v.name AS vendor
     FROM invoices i
     JOIN vendors v ON v.id = i.vendor_id
     WHERE i.id = ?`,
    [id]
  );

  if (!invoice) throw new Error(`Invoice with ID ${id} not found`);

  const [items] = await db.query(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
    [id]
  );
  invoice.items = items;

  // Mark status as PROCESSING
  await db.query("UPDATE invoices SET status = 'PROCESSING' WHERE id = ?", [id]);

  try {
    // Stage 1: Invoice Processing Agent (AI extraction & mathematical verification)
    const t1 = new Date();
    const invoiceAgentResult = await invoiceAgent.run(invoice);
    await logAgentRun(id, invoiceAgent.name, 'COMPLETED', invoiceAgentResult, t1);

    // Stage 2: Purchase Order Agent (ERP PO retrieval & item verification)
    const t2 = new Date();
    const poResult = await purchaseOrderAgent.run(invoice.po_number);
    await logAgentRun(
      id,
      purchaseOrderAgent.name,
      poResult.status === 'FOUND' ? 'COMPLETED' : 'FAILED',
      poResult,
      t2
    );

    const poData = poResult.data;

    // Stage 3: Delivery & GRN Agent (Split delivery aggregation & warehouse receipts)
    const t3 = new Date();
    let grnResult = null;
    if (poData?.id) {
      grnResult = await deliveryGrnAgent.run(poData.id);
      await logAgentRun(id, deliveryGrnAgent.name, 'COMPLETED', grnResult, t3);
    } else {
      grnResult = {
        agent: deliveryGrnAgent.name,
        timestamp: new Date().toISOString(),
        data: { deliveriesCount: 0, grnsCount: 0, deliveries: [], grns: [], grnItems: [], receivedByItem: {}, totalReceived: 0 }
      };
      await logAgentRun(id, deliveryGrnAgent.name, 'COMPLETED', grnResult, t3);
    }

    // Stage 4: Reconciliation Agent (Multi-item 3-way matching engine + AI synthesis)
    const t4 = new Date();
    const matchResult = await reconciliationAgent.run({
      invoice,
      po: poResult,
      grn: grnResult
    });
    await logAgentRun(id, reconciliationAgent.name, 'COMPLETED', matchResult, t4);

    // Stage 5: Exception Agent (if mismatch detected, diagnose root cause and recommend action)
    let exceptionResult = null;
    if (matchResult.status === 'MISMATCH') {
      const t5 = new Date();
      exceptionResult = await exceptionAgent.run(matchResult);
      await logAgentRun(id, exceptionAgent.name, 'COMPLETED', exceptionResult, t5);

      // Clear any previous pending exceptions for this invoice to prevent duplicate entries
      await db.query('DELETE FROM mismatch_exceptions WHERE invoice_id = ?', [id]);

      await db.query(
        `INSERT INTO mismatch_exceptions(invoice_id, exception_type, severity, explanation, recommended_action, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING_REVIEW')`,
        [
          id,
          exceptionResult.data.type,
          exceptionResult.data.severity,
          exceptionResult.data.explanation,
          exceptionResult.data.recommendedAction
        ]
      );
    } else {
      // If invoice previously had exceptions and now passed, clear them
      await db.query("UPDATE mismatch_exceptions SET status = 'RESOLVED' WHERE invoice_id = ? AND status = 'PENDING_REVIEW'", [id]);
    }

    // Persist processing results
    await db.query(
      `INSERT INTO processing_results(invoice_id, po_id, status, result_json, processed_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         po_id = VALUES(po_id),
         status = VALUES(status),
         result_json = VALUES(result_json),
         processed_at = NOW()`,
      [id, poData?.id || null, matchResult.status, JSON.stringify(matchResult)]
    );

    const finalInvoiceStatus = matchResult.status === 'MATCHED' ? 'MATCHED' : 'PENDING_REVIEW';
    await db.query('UPDATE invoices SET status = ? WHERE id = ?', [finalInvoiceStatus, id]);

    // Record audit log
    await db.query(
      `INSERT INTO audit_logs(action, entity_type, entity_id, details)
       VALUES (?, 'invoice', ?, ?)`,
      [
        matchResult.status === 'MATCHED' ? 'RECONCILIATION_MATCHED' : 'RECONCILIATION_MISMATCH',
        id,
        matchResult.status === 'MATCHED'
          ? `Automatic 3-way match passed successfully for ${invoice.invoice_number}`
          : `Discrepancies identified on ${invoice.invoice_number} - moved to Approval Queue`
      ]
    );

    return {
      success: true,
      invoiceId: id,
      invoiceNumber: invoice.invoice_number,
      status: finalInvoiceStatus,
      invoice,
      po: poData,
      grn: grnResult.data,
      result: matchResult,
      exception: exceptionResult?.data || null,
      aiMode: matchResult.aiMode
    };
  } catch (error) {
    console.error(`Error processing invoice ${id}:`, error);
    await db.query("UPDATE invoices SET status = 'ERROR' WHERE id = ?", [id]);
    throw error;
  }
}

// Automatically generate an invoice for a PO based on receipt status, and run 3-way reconciliation
export async function autoGenerateInvoiceForPO(poNumber, options = {}) {
  // 1. Fetch PO and items
  const [[po]] = await db.query(
    `SELECT po.*, v.name AS vendor_name, v.id AS vendor_id
     FROM purchase_orders po
     JOIN vendors v ON v.id = po.vendor_id
     WHERE po.po_number = ?`,
    [poNumber.trim()]
  );
  if (!po) throw new Error(`PO '${poNumber}' not found`);

  const [poItems] = await db.query(
    'SELECT * FROM purchase_order_items WHERE po_id = ?',
    [po.id]
  );
  if (!poItems.length) throw new Error(`PO '${poNumber}' has no items`);

  // 2. Query GRN items received so far
  const [grnItems] = await db.query(
    `SELECT gi.item_name, SUM(gi.accepted_quantity) AS accepted_quantity
     FROM grn_items gi
     JOIN grns g ON g.id = gi.grn_id
     WHERE g.po_id = ?
     GROUP BY gi.item_name`,
    [po.id]
  );
  const recMap = {};
  for (const gi of grnItems) {
    recMap[gi.item_name.trim().toLowerCase()] = Number(gi.accepted_quantity);
  }

  // 3. Generate sequential invoice number (e.g. INV-1001 or INV-PO-1001)
  const baseNum = po.po_number.replace(/^PO-?/, '');
  let invoiceNo = `INV-${baseNum}`;
  const [[existingInv]] = await db.query(
    'SELECT id, invoice_number FROM invoices WHERE invoice_number = ?',
    [invoiceNo]
  );
  if (existingInv) {
    invoiceNo = `INV-${baseNum}-${Date.now().toString().slice(-4)}`;
  }

  // 4. Determine billed quantities
  let subtotal = 0;
  const invoiceLineItems = [];

  for (const pItem of poItems) {
    const ordered = Number(pItem.ordered_quantity);
    const received = recMap[pItem.item_name.trim().toLowerCase()] ?? ordered;
    const price = Number(pItem.unit_price);

    let billedQty = ordered;
    if (options.mode === 'less_received') {
      // Vendor billed full PO (100), but warehouse got less
      billedQty = ordered;
    } else if (options.mode === 'more_received') {
      // Vendor billed for excess
      billedQty = Math.max(ordered + 10, received);
    } else {
      // Auto-detect based on physical receipt:
      if (received > ordered) {
        // Warehouse took in excess (e.g. 110) -> vendor bills for 110 (triggers over-delivery check!)
        billedQty = received;
      } else if (received < ordered) {
        // Warehouse got less (e.g. 80) -> vendor bills for 100 (triggers short-delivery check!)
        billedQty = ordered;
      } else {
        billedQty = ordered;
      }
    }

    const lineTotal = billedQty * price;
    subtotal += lineTotal;
    invoiceLineItems.push({
      itemName: pItem.item_name,
      quantity: billedQty,
      unitPrice: price,
      lineTotal
    });
  }

  const taxAmount = Math.round(subtotal * 0.18);
  const totalAmount = subtotal + taxAmount;

  // 5. Insert invoice
  const [invIns] = await db.query(
    `INSERT INTO invoices(invoice_number, vendor_id, po_number, invoice_date, tax_amount, total_amount, status)
     VALUES (?, ?, ?, NOW(), ?, ?, 'UPLOADED')`,
    [invoiceNo, po.vendor_id, po.po_number, taxAmount, totalAmount]
  );
  const invoiceId = invIns.insertId;

  for (const it of invoiceLineItems) {
    await db.query(
      `INSERT INTO invoice_items(invoice_id, item_name, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?)`,
      [invoiceId, it.itemName, it.quantity, it.unitPrice, it.lineTotal]
    );
  }

  await db.query(
    'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
    [
      'AUTO_INVOICE_GENERATED',
      'invoice',
      String(invoiceId),
      `Automated Invoice ${invoiceNo} generated for ${po.po_number} (Total: ₹${totalAmount.toLocaleString()})`
    ]
  );

  // 6. Automatically execute 3-way reconciliation agent
  const reconResult = await processInvoice(invoiceId);

  return {
    success: true,
    invoiceId,
    invoiceNumber: invoiceNo,
    status: reconResult.status,
    reconciliation: reconResult.result,
    exception: reconResult.exception,
    matchClassification: reconResult.result?.matchClassification,
    matchLabel: reconResult.result?.matchLabel
  };
}

