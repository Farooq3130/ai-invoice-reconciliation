import { db } from '../config/db.js';
import { askGroq } from './groqService.js';
import { deliveryGrnAgent } from '../agents/deliveryGrnAgent.js';
import { processInvoice } from './orchestratorService.js';

// Standard catalog item mapping, default vendors, and unit prices
const CATALOG = {
  laptop: { canonical: 'Laptop', defaultVendor: 'ABC Supplies', unitPrice: 50000 },
  monitor: { canonical: 'Monitor', defaultVendor: 'XYZ Displays', unitPrice: 20000 },
  printer: { canonical: 'Printer', defaultVendor: 'TechSource India', unitPrice: 25000 },
  chair: { canonical: 'Office Chair', defaultVendor: 'Office Essentials', unitPrice: 5000 },
  router: { canonical: 'Router', defaultVendor: 'Network Hub', unitPrice: 15000 },
  server: { canonical: 'Server', defaultVendor: 'TechSource India', unitPrice: 80000 },
  keyboard: { canonical: 'Keyboard', defaultVendor: 'ABC Supplies', unitPrice: 3000 },
  desk: { canonical: 'Desk', defaultVendor: 'Office Essentials', unitPrice: 6000 },
  switch: { canonical: 'Switch', defaultVendor: 'Network Hub', unitPrice: 15000 }
};

/**
 * Heuristic parser for instant, deterministic extraction of intent and parameters.
 * Handles colloquial expressions, abbreviations, and common typos like "lppots", "recived", etc.
 */
export function parseIntentHeuristic(rawText) {
  const text = String(rawText || '').trim();
  const lower = text.toLowerCase();

  // Normalize common typos
  const normalized = lower
    .replace(/lppots?|lappys?|lap tops?/g, 'laptop')
    .replace(/recived|recieved|had received/g, 'received')
    .replace(/purcases?|purchses?/g, 'purchase');

  // 1. PO Number matching
  const poMatch = normalized.match(/\bpo[-_\s]?(\d{3,6})\b/i) || normalized.match(/\b(po-[a-z0-9-]+)\b/i);
  let poNumber = null;
  if (poMatch) {
    poNumber = poMatch[0].toUpperCase().replace(/\s+/, '-');
    if (!poNumber.startsWith('PO-')) {
      poNumber = 'PO-' + poNumber.replace(/^PO/, '');
    }
  }

  // 2. Quantity extraction
  let quantity = null;
  // Match "buy 20", "received 15", "15 laptops", "20 units", "10 pcs"
  const qtyPatterns = [
    /(?:buy|order|purchase|procure|received|delivered|got|take)\s+(?:about\s+|approximately\s+)?(\d+)/i,
    /(\d+)\s*(?:units?|pcs?|pieces?|nos?|items?)?\s*(?:of\s+)?(laptops?|monitors?|printers?|servers?|desks?|chairs?|routers?|keyboards?|switches?|items?)/i,
    /\b(\d+)\b/
  ];
  for (const pat of qtyPatterns) {
    const m = normalized.match(pat);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (parsed > 0 && parsed < 100000) {
        quantity = parsed;
        break;
      }
    }
  }

  // 3. Item extraction
  let item = 'Laptop'; // default
  let catalogEntry = CATALOG.laptop;
  for (const [key, entry] of Object.entries(CATALOG)) {
    if (normalized.includes(key) || normalized.includes(entry.canonical.toLowerCase())) {
      item = entry.canonical;
      catalogEntry = entry;
      break;
    }
  }

  // 4. Vendor extraction
  let vendor = null;
  if (/abc\s*(supplies)?/i.test(normalized)) vendor = 'ABC Supplies';
  else if (/xyz\s*(displays)?/i.test(normalized)) vendor = 'XYZ Displays';
  else if (/techsource(\s*india)?|tsi/i.test(normalized)) vendor = 'TechSource India';
  else if (/office\s*essentials/i.test(normalized)) vendor = 'Office Essentials';
  else if (/network\s*hub/i.test(normalized)) vendor = 'Network Hub';
  else if (/from\s+([A-Za-z0-9\s]+?)(?:\s+(?:at|for|with)|\.|$)/i.test(normalized)) {
    const vm = normalized.match(/from\s+([A-Za-z0-9\s]+?)(?:\s+(?:at|for|with)|\.|$)/i);
    if (vm && vm[1] && vm[1].trim().length >= 3) {
      vendor = vm[1].trim();
    }
  }

  // 5. Unit price extraction (e.g. "at 45000", "@ 50,000", "price 50000")
  let unitPrice = null;
  const priceMatch = normalized.match(/(?:at|@|price|rate|cost)\s*(?:rs\.?|inr|₹)?\s*([\d,]+)/i);
  if (priceMatch) {
    const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (p > 0) unitPrice = p;
  }

  // 6. Invoice Number matching (e.g. "INV-1001", "INV-2478")
  const invMatch = normalized.match(/\binv[-_\s]?([a-z0-9-]+)\b/i);
  let invoiceNumber = null;
  if (invMatch) {
    invoiceNumber = invMatch[0].toUpperCase().replace(/\s+/, '-');
    if (!invoiceNumber.startsWith('INV-')) {
      invoiceNumber = 'INV-' + invoiceNumber.replace(/^INV/, '');
    }
  }

  // 7. Intent classification
  const isClearChat =
    /\b(clear\s*(?:the\s*)?(?:my\s*)?chat|clearchat|delete\s*(?:the\s*)?(?:my\s*)?chat|wipe\s*(?:the\s*)?(?:my\s*)?chat|reset\s*(?:the\s*)?(?:my\s*)?chat)\b/i.test(normalized) ||
    /^(?:clear|\/clear|clear\s*history|clear\s*my\s*chat|delete\s*my\s*chat)$/i.test(normalized.trim());
  const isApprove = /\b(approve|sign\s*off|authorization|confirm\s*approval)\b/i.test(normalized);
  const isCheckInvoice = (
    /\binvoices?\b/i.test(normalized) ||
    Boolean(invoiceNumber) ||
    /\b(how\s+many\s+rec[oe]ved|how\s+many\s+l[eo]pt|how\s+many\s+left|issues?\s+in\s+rec[ei]ving)\b/i.test(normalized)
  ) && /\b(check|status|how\s+many|issues?|verify|rec[oe]ved|l[eo]pt|left|inspect|audit|discrepanc)/i.test(normalized);

  const isBuy = /\b(buy|purchase|order|procure|create\s*(?:a\s*)?(?:po|purchase\s*order|order)|get\s+\d+)\b/i.test(normalized);
  const isReceive = /\b(received|recieved|recived|arrived|dock|delivery|deliver|got\s+\d+|delivered|log\s+delivery)\b/i.test(normalized);
  const isQuery = /\b(status|track|show|list|check|find|view)\b/i.test(normalized);

  let intent = 'CHAT';
  if (isClearChat) {
    intent = 'CLEAR_CHAT';
  } else if (isApprove) {
    intent = 'APPROVE_INVOICE';
  } else if (isCheckInvoice && !isBuy && !isReceive) {
    intent = 'CHECK_INVOICE';
  } else if (isReceive && !isBuy) {
    intent = 'RECORD_DELIVERY';
  } else if (isBuy && !isReceive) {
    intent = 'CREATE_PO';
  } else if (isQuery) {
    intent = 'QUERY';
  }

  return {
    intent,
    item,
    quantity: quantity || (intent === 'CREATE_PO' ? 20 : 10),
    vendor: vendor || catalogEntry.defaultVendor,
    unitPrice: unitPrice || catalogEntry.unitPrice,
    poNumber,
    invoiceNumber,
    rawText
  };
}

/**
 * Handle chat conversation and execute autonomous ERP actions with strict role-based access control.
 */
export async function handleChatMessage({ message, user }) {
  if (!message || !message.trim()) {
    return {
      message: "Please enter a command or message (e.g. *'buy 20 laptops'* or *'received 10 laptops'* or *'check invoice INV-1001'*).",
      intent: 'EMPTY',
      userRole: user?.role || 'GUEST'
    };
  }

  const role = (user?.role || 'ADMIN').toUpperCase();
  const userName = user?.name || 'User';

  // 1. Initial heuristic parse
  let parsed = parseIntentHeuristic(message);

  // If user requests to clear chat, return CLEAR_CHAT response immediately
  if (parsed.intent === 'CLEAR_CHAT') {
    return {
      intent: 'CLEAR_CHAT',
      success: true,
      clearChat: true,
      message: `🧹 **Chat Cleared:** All chat messages up to this point have been deleted for **${userName}**.\n\nYou can start a fresh conversation below.`,
      userRole: role
    };
  }

  // 2. Enhance with Groq AI if active
  try {
    const aiSystemPrompt = `You are an AI ERP Agent for Procurement, Inbound Dock Logistics, and Invoice Reconciliation.
Determine the user's intent and parameters from their message.
Possible intents:
- "CREATE_PO": user wants to purchase, buy, or create an order for items.
- "RECORD_DELIVERY": user wants to record receiving goods at the warehouse dock or deliver items.
- "CHECK_INVOICE": user wants to check an invoice status, how many received vs how many left, or check receiving issues.
- "APPROVE_INVOICE": user wants to approve an invoice.
- "QUERY": user is asking for status or info about a PO, delivery, or general system data.
- "CHAT": general conversation or greeting.

Output strictly a JSON object:
{
  "intent": "CREATE_PO" | "RECORD_DELIVERY" | "CHECK_INVOICE" | "APPROVE_INVOICE" | "QUERY" | "CHAT",
  "item": "Laptop" | "Monitor" | "Printer" | "Office Chair" | "Router" | "Server" | "Keyboard" | "Desk" | "Switch",
  "quantity": number or null,
  "vendor": string or null,
  "unitPrice": number or null,
  "poNumber": string or null,
  "invoiceNumber": string or null
}`;

    const aiRes = await askGroq(
      aiSystemPrompt,
      { message, activeRole: role, userName },
      parsed
    );

    if (aiRes?.data?.intent && ['CREATE_PO', 'RECORD_DELIVERY', 'CHECK_INVOICE', 'APPROVE_INVOICE', 'QUERY', 'CHAT'].includes(aiRes.data.intent)) {
      parsed.intent = aiRes.data.intent;
      if (aiRes.data.item) parsed.item = aiRes.data.item;
      if (aiRes.data.quantity) parsed.quantity = Number(aiRes.data.quantity);
      if (aiRes.data.vendor) parsed.vendor = aiRes.data.vendor;
      if (aiRes.data.unitPrice) parsed.unitPrice = Number(aiRes.data.unitPrice);
      if (aiRes.data.poNumber) parsed.poNumber = aiRes.data.poNumber;
      if (aiRes.data.invoiceNumber) parsed.invoiceNumber = aiRes.data.invoiceNumber;
    }
  } catch (err) {
    // Graceful fallback to heuristic parsing
  }

  // --------------------------------------------------------------------------
  // INTENT: CREATE PURCHASE ORDER (BUY)
  // --------------------------------------------------------------------------
  if (parsed.intent === 'CREATE_PO') {
    // Role Authorization Check:
    // Only PURCHASER or ADMIN can create Purchase Orders
    if (role !== 'PURCHASER' && role !== 'ADMIN') {
      return {
        intent: 'ROLE_DENIED',
        roleDenied: true,
        actionAttempted: 'CREATE_PO',
        currentRole: role,
        requiredRole: 'PURCHASER or ADMIN',
        message: `⛔ **Authorization Restriction (Active Role: ${role})**\n\n` +
          `You are logged in as **${userName}** with the **${role}** role. ` +
          `Purchase Order creation is restricted to **🛒 PURCHASER** or **👑 ADMIN** personnel.\n\n` +
          `• **Why?** Warehouse dock staff and Reviewers cannot commit financial purchase contracts.\n` +
          `• **How to proceed:** Use the role switcher above to switch to **Peter Purchaser** (or Admin) to place this order.`,
        requiresRefresh: false
      };
    }

    // Execute Purchase Order Creation
    try {
      const itemName = parsed.item || 'Laptop';
      const quantity = Math.max(1, Number(parsed.quantity) || 20);
      const catalogEntry = CATALOG[itemName.toLowerCase()] || CATALOG.laptop;
      const unitPrice = parsed.unitPrice || catalogEntry.unitPrice;
      const vendorName = parsed.vendor || catalogEntry.defaultVendor;
      const totalAmount = quantity * unitPrice;

      // Find or create vendor
      let [[v]] = await db.query('SELECT id, name, code FROM vendors WHERE LOWER(name) = LOWER(?)', [vendorName.trim()]);
      if (!v) {
        const code = vendorName.trim().slice(0, 3).toUpperCase() + Math.floor(10 + Math.random() * 89);
        const [vIns] = await db.query('INSERT INTO vendors(name, code) VALUES(?, ?)', [vendorName.trim(), code]);
        v = { id: vIns.insertId, name: vendorName.trim(), code };
      }

      // Generate a unique PO Number
      let poNumber = parsed.poNumber;
      if (!poNumber) {
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          attempts++;
          const candidate = `PO-${Math.floor(1000 + Math.random() * 9000)}`;
          const [exists] = await db.query('SELECT id FROM purchase_orders WHERE po_number = ?', [candidate]);
          if (!exists.length) {
            poNumber = candidate;
            isUnique = true;
          }
        }
        if (!poNumber) poNumber = `PO-${Date.now().toString().slice(-4)}`;
      }

      // Insert Purchase Order
      const orderDate = new Date();
      const [poIns] = await db.query(
        'INSERT INTO purchase_orders(po_number, vendor_id, status, order_date, total_amount) VALUES(?, ?, ?, ?, ?)',
        [poNumber, v.id, 'OPEN', orderDate, totalAmount]
      );
      const poId = poIns.insertId;

      // Insert Line Item
      await db.query(
        'INSERT INTO purchase_order_items(po_id, item_name, ordered_quantity, unit_price) VALUES(?, ?, ?, ?)',
        [poId, itemName, quantity, unitPrice]
      );

      // Pre-generate linked invoice in BLOCKED status (unlocks when warehouse logs delivery)
      const invNo = `INV-${poNumber.replace(/^PO-?/, '')}`;
      const taxAmount = Math.round(totalAmount * 0.18);
      const invoiceTotal = totalAmount + taxAmount;

      const [invIns] = await db.query(
        `INSERT INTO invoices(invoice_number, vendor_id, po_number, invoice_date, tax_amount, total_amount, status)
         VALUES (?, ?, ?, NOW(), ?, ?, 'BLOCKED')`,
        [invNo, v.id, poNumber, taxAmount, invoiceTotal]
      );

      await db.query(
        `INSERT INTO invoice_items(invoice_id, item_name, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
        [invIns.insertId, itemName, quantity, unitPrice, totalAmount]
      );

      // Record Audit Log
      await db.query(
        'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
        [
          'PO_CREATED_AI_COPILOT',
          'purchase_order',
          String(poId),
          `PO ${poNumber} created via AI Chatbot by ${userName} (${role}) for ${quantity}x ${itemName} with ${v.name} (Total: ₹${totalAmount.toLocaleString()})`
        ]
      );

      const formattedTotal = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(totalAmount);
      const formattedInvoiceTotal = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(invoiceTotal);

      return {
        intent: 'CREATE_PO',
        success: true,
        message: `🎉 **Purchase Order ${poNumber} Successfully Created!**\n\n` +
          `• **PO Number:** \`${poNumber}\`\n` +
          `• **Item Ordered:** **${quantity}x ${itemName}**\n` +
          `• **Vendor:** **${v.name}**\n` +
          `• **Unit Price:** ₹${unitPrice.toLocaleString('en-IN')}\n` +
          `• **Total Order Value:** **${formattedTotal}** (Pre-tax)\n` +
          `• **Order Status:** \`OPEN\`\n` +
          `• **Pre-Generated Invoice:** \`${invNo}\` (Status: \`BLOCKED\` pending inbound warehouse dock receipt)\n\n` +
          `👉 *Next Step:* Once goods arrive at the dock, switch to **Vikram Warehouse** and message *"received ${quantity} laptops for ${poNumber}"* to record delivery & trigger autonomous 3-way reconciliation!`,
        data: {
          poId,
          poNumber,
          vendor: v.name,
          vendorCode: v.code,
          itemName,
          quantity,
          unitPrice,
          totalAmount,
          invoiceNumber: invNo,
          invoiceTotal: formattedInvoiceTotal,
          status: 'OPEN'
        },
        requiresRefresh: true
      };
    } catch (err) {
      console.error('[Chatbot Error - Create PO]:', err);
      return {
        intent: 'CREATE_PO',
        success: false,
        error: err.message,
        message: `❌ **Failed to create Purchase Order:** ${err.message}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTENT: RECORD DELIVERY & GRN (RECEIVE)
  // --------------------------------------------------------------------------
  if (parsed.intent === 'RECORD_DELIVERY') {
    // Role Authorization Check:
    // Only WAREHOUSE or ADMIN can record dock deliveries
    if (role !== 'WAREHOUSE' && role !== 'ADMIN') {
      return {
        intent: 'ROLE_DENIED',
        roleDenied: true,
        actionAttempted: 'RECORD_DELIVERY',
        currentRole: role,
        requiredRole: 'WAREHOUSE or ADMIN',
        message: `⛔ **Authorization Restriction (Active Role: ${role})**\n\n` +
          `You are logged in as **${userName}** with the **${role}** role. ` +
          `Dock delivery receiving and GRN inspection must be recorded by **📦 WAREHOUSE** or **👑 ADMIN** personnel.\n\n` +
          `• **Why?** Physical warehouse receiving must be authenticated by dock logistics staff.\n` +
          `• **How to proceed:** Use the role switcher above to switch to **Vikram Warehouse** (or Admin) to log this delivery.`,
        requiresRefresh: false
      };
    }

    // Execute Inbound Dock Delivery & GRN
    try {
      const itemName = parsed.item || 'Laptop';
      const quantity = Math.max(1, Number(parsed.quantity) || 10);

      // Locate matching Purchase Order
      let po = null;
      if (parsed.poNumber) {
        const [pos] = await db.query(
          `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
           FROM purchase_orders po
           JOIN vendors v ON v.id = po.vendor_id
           WHERE po.po_number = ?`,
          [parsed.poNumber.trim()]
        );
        po = pos[0];
      }

      // If PO not explicitly specified, automatically match the most recent open / partially delivered PO for this item
      if (!po) {
        const [candidates] = await db.query(`
          SELECT po.*, v.name AS vendor_name, v.code AS vendor_code,
                 poi.item_name, poi.ordered_quantity,
                 COALESCE((
                   SELECT SUM(gi.accepted_quantity)
                   FROM grn_items gi
                   JOIN grns g ON g.id = gi.grn_id
                   WHERE g.po_id = po.id AND LOWER(gi.item_name) = LOWER(poi.item_name)
                 ), 0) AS total_accepted
          FROM purchase_orders po
          JOIN vendors v ON v.id = po.vendor_id
          JOIN purchase_order_items poi ON poi.po_id = po.id
          WHERE LOWER(poi.item_name) LIKE ?
          ORDER BY po.id DESC
        `, [`%${itemName.toLowerCase()}%`]);

        if (candidates.length > 0) {
          // Prefer an open PO that still has remaining pending quantity
          const unfulfilled = candidates.find(c => Number(c.total_accepted) < Number(c.ordered_quantity));
          po = unfulfilled || candidates[0];
        }
      }

      if (!po) {
        return {
          intent: 'RECORD_DELIVERY',
          success: false,
          message: `⚠️ **No matching Purchase Order found for item "${itemName}".**\n\n` +
            `Please specify a valid PO number (e.g. *"received ${quantity} laptops for PO-1001"*), ` +
            `or have the **Purchaser** create a purchase order for ${itemName} first.`
        };
      }

      // Call Autonomous Delivery & GRN Agent
      const deliveryNumber = `DEL-${Date.now().toString().slice(-5)}`;
      const grnResult = await deliveryGrnAgent.matchDeliveryAndGenerateGRN({
        deliveryNumber,
        deliveryDate: new Date(),
        poNumber: po.po_number,
        vendor: po.vendor_name,
        items: [{ item_name: itemName, quantity }],
        notes: `Inbound delivery logged via AI Chatbot by ${userName} (${role})`
      });

      // Automatically unblock pre-generated BLOCKED invoice and execute 3-way reconciliation
      let autoReconciledInvoice = null;
      try {
        const [[existingInv]] = await db.query(
          'SELECT id, invoice_number, status FROM invoices WHERE po_number = ? ORDER BY id DESC LIMIT 1',
          [po.po_number]
        );
        if (existingInv) {
          if (existingInv.status === 'BLOCKED' || grnResult.fulfillment?.isFullyDelivered) {
            autoReconciledInvoice = await processInvoice(existingInv.id);
          }
        }
      } catch (err) {
        console.warn(`[Chatbot Auto-Reconciliation Notice for ${po.po_number}]:`, err.message);
      }

      const f = grnResult.fulfillment || {};
      const statusBadge = f.isFullyDelivered
        ? '✅ FULLY DELIVERED (100%)'
        : f.isOverDelivered
        ? '⚠️ OVER-DELIVERED (Excess Shipment)'
        : `📦 PARTIALLY DELIVERED (${f.totalAccepted}/${f.orderedQty})`;

      const delNumber = grnResult.delivery?.deliveryNumber || grnResult.deliveryNumber || deliveryNumber;
      const grnNumber = grnResult.grn?.grnNumber || grnResult.grnNumber || 'GRN-001';

      return {
        intent: 'RECORD_DELIVERY',
        success: true,
        message: `🚚 **Inbound Delivery & GRN Recorded Successfully!**\n\n` +
          `• **Delivery Slip:** \`${delNumber}\`\n` +
          `• **Purchase Order:** \`${po.po_number}\` (${po.vendor_name})\n` +
          `• **Single PO GRN:** \`${grnNumber}\`\n` +
          `• **Delivered & Inspected:** **${quantity}x ${itemName}**\n` +
          `• **Fulfillment Progress:** **${f.totalAccepted || quantity} / ${f.orderedQty || quantity}** (${statusBadge})\n` +
          (autoReconciledInvoice
            ? `• **3-Way Reconciliation:** Linked invoice \`${autoReconciledInvoice.invoice?.invoice_number || 'INV'}\` unblocked from \`BLOCKED\` status and matched! (\`Status: ${autoReconciledInvoice.invoice?.status || 'MATCHED'}\`)\n`
            : '') +
          `\n👉 *View Details:* Check the **Deliveries & GRNs** tab to view the updated inspection record and cumulative GRN log.`,
        data: {
          deliveryNumber: delNumber,
          grnNumber,
          poNumber: po.po_number,
          vendor: po.vendor_name,
          itemName,
          quantity,
          fulfillment: f,
          autoReconciledInvoice
        },
        requiresRefresh: true
      };
    } catch (err) {
      console.error('[Chatbot Error - Record Delivery]:', err);
      return {
        intent: 'RECORD_DELIVERY',
        success: false,
        error: err.message,
        message: `❌ **Failed to record delivery:** ${err.message}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTENT: CHECK INVOICE STATUS & RECEIVING DISCREPANCIES ("HOW MANY RECEIVED, HOW MANY LEFT")
  // --------------------------------------------------------------------------
  if (parsed.intent === 'CHECK_INVOICE') {
    try {
      let invRow = null;
      if (parsed.invoiceNumber) {
        const [rows] = await db.query(
          `SELECT i.*, v.name AS vendor_name, v.code AS vendor_code
           FROM invoices i
           JOIN vendors v ON v.id = i.vendor_id
           WHERE LOWER(i.invoice_number) = LOWER(?)`,
          [parsed.invoiceNumber.trim()]
        );
        invRow = rows[0];
      }

      // If no invoice number specified, find the most recent invoice
      if (!invRow) {
        const [rows] = await db.query(
          `SELECT i.*, v.name AS vendor_name, v.code AS vendor_code
           FROM invoices i
           JOIN vendors v ON v.id = i.vendor_id
           ORDER BY i.id DESC LIMIT 1`
        );
        invRow = rows[0];
      }

      if (!invRow) {
        return {
          intent: 'CHECK_INVOICE',
          success: false,
          message: '⚠️ No invoices found in the system to inspect.'
        };
      }

      // Fetch invoice line items
      const [invItems] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invRow.id]);

      // Fetch linked PO details
      let poRow = null;
      let poItems = [];
      if (invRow.po_number) {
        const [pos] = await db.query(
          'SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id WHERE po.po_number = ?',
          [invRow.po_number]
        );
        poRow = pos[0];
        if (poRow) {
          const [poi] = await db.query('SELECT * FROM purchase_order_items WHERE po_id = ?', [poRow.id]);
          poItems = poi;
        }
      }

      // Fetch goods received (GRN items)
      let grnItems = [];
      if (poRow) {
        const [gi] = await db.query(
          `SELECT gi.item_name, SUM(gi.accepted_quantity) AS total_accepted
           FROM grn_items gi
           JOIN grns g ON g.id = gi.grn_id
           WHERE g.po_id = ?
           GROUP BY gi.item_name`,
          [poRow.id]
        );
        grnItems = gi;
      }

      // Fetch exceptions
      const [exceptions] = await db.query(
        'SELECT * FROM mismatch_exceptions WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
        [invRow.id]
      );
      const exc = exceptions[0] || null;

      // Calculate breakdown for each item
      const breakdown = [];
      let totalInvoicedQty = 0;
      let totalOrderedQty = 0;
      let totalReceivedQty = 0;
      let totalLeftQty = 0;
      const issues = [];

      for (const it of invItems) {
        const invoicedQty = Number(it.quantity);
        const invoicedPrice = Number(it.unitPrice || it.unit_price);
        totalInvoicedQty += invoicedQty;

        const matchingPoi = poItems.find(p => p.item_name.toLowerCase() === it.item_name.toLowerCase()) || poItems[0];
        const orderedQty = matchingPoi ? Number(matchingPoi.ordered_quantity) : invoicedQty;
        const poPrice = matchingPoi ? Number(matchingPoi.unit_price) : invoicedPrice;
        totalOrderedQty += orderedQty;

        const matchingGrn = grnItems.find(g => g.item_name.toLowerCase() === it.item_name.toLowerCase());
        const receivedQty = matchingGrn ? Number(matchingGrn.total_accepted) : 0;
        totalReceivedQty += receivedQty;

        const leftQty = Math.max(0, orderedQty - receivedQty);
        totalLeftQty += leftQty;
        const excessQty = Math.max(0, receivedQty - orderedQty);

        const itemIssues = [];
        if (receivedQty === 0) {
          itemIssues.push(`Not received at dock yet (all ${orderedQty} units remaining).`);
        } else if (receivedQty < invoicedQty) {
          itemIssues.push(`Short Delivery: Invoiced ${invoicedQty} units, but warehouse only received ${receivedQty} (${invoicedQty - receivedQty} units missing/unreceived).`);
        } else if (receivedQty > orderedQty) {
          itemIssues.push(`Over Delivery: Warehouse received ${receivedQty} units exceeding PO authorized limit (${orderedQty}) by ${excessQty} excess units.`);
        }

        if (invoicedPrice !== poPrice) {
          itemIssues.push(`Price Mismatch: Invoiced unit price ₹${invoicedPrice.toLocaleString('en-IN')} vs PO unit price ₹${poPrice.toLocaleString('en-IN')}.`);
        }

        if (itemIssues.length) {
          issues.push(...itemIssues);
        }

        breakdown.push({
          itemName: it.item_name,
          invoicedQty,
          orderedQty,
          receivedQty,
          leftQty,
          excessQty,
          invoicedPrice,
          poPrice,
          itemIssues
        });
      }

      if (invRow.status === 'BLOCKED') {
        issues.push('Invoice is currently in BLOCKED status pending warehouse dock delivery.');
      }

      const isCleanMatch = issues.length === 0 && totalReceivedQty >= totalInvoicedQty;
      const isAlreadyApproved = invRow.status === 'APPROVED';

      const breakdownText = breakdown.map(b => (
        `• **${b.itemName}**:\n` +
        `  - 📄 Invoiced: **${b.invoicedQty} units** (@ ₹${b.invoicedPrice.toLocaleString('en-IN')})\n` +
        `  - 📋 PO Contract: **${b.orderedQty} units** (@ ₹${b.poPrice.toLocaleString('en-IN')})\n` +
        `  - 📥 **Received so far (Dock GRN):** **${b.receivedQty} units**\n` +
        `  - ⏳ **Left to receive (Remaining):** **${b.leftQty} units**` +
        (b.excessQty > 0 ? `\n  - 📦 Excess Received: **+${b.excessQty} surplus**` : '') +
        (b.itemIssues.length ? `\n  - ⚠️ *Note:* ${b.itemIssues.join(' ')}` : '')
      )).join('\n\n');

      const issuesText = issues.length > 0
        ? `⚠️ **Issues Detected (${issues.length}):**\n` + issues.map(i => `• ${i}`).join('\n')
        : `✅ **No Issues Detected:** Goods received, PO limits, and invoiced prices match 100%!`;

      const approvalText = isAlreadyApproved
        ? `ℹ️ *This invoice has already been APPROVED.*`
        : isCleanMatch
        ? `🎯 **Everything is right!** All quantities and rates match. You can approve this invoice.`
        : exc
        ? `⚠️ *Reviewer Assessment:* ${exc.explanation || 'Discrepancy flagged in 3-way reconciliation.'}`
        : `*You can approve this invoice or review it in the Approval Queue.*`;

      return {
        intent: 'CHECK_INVOICE',
        success: true,
        message: `📄 **Invoice Status Report: ${invRow.invoice_number}**\n\n` +
          `• **Vendor:** **${invRow.vendor_name}**\n` +
          `• **Linked PO:** \`${invRow.po_number || 'None'}\`\n` +
          `• **Total Amount:** **₹${Number(invRow.total_amount).toLocaleString('en-IN')}**\n` +
          `• **Status:** \`${invRow.status}\`\n\n` +
          `📊 **Quantities Breakdown ("How many received vs how many left"):**\n${breakdownText}\n\n` +
          `${issuesText}\n\n` +
          `${approvalText}`,
        data: {
          invoiceId: invRow.id,
          invoiceNumber: invRow.invoice_number,
          poNumber: invRow.po_number,
          vendor: invRow.vendor_name,
          status: invRow.status,
          totalAmount: invRow.total_amount,
          breakdown,
          totalInvoicedQty,
          totalOrderedQty,
          totalReceivedQty,
          totalLeftQty,
          hasIssues: issues.length > 0,
          issues,
          isCleanMatch,
          isAlreadyApproved,
          canApprove: !isAlreadyApproved && invRow.status !== 'BLOCKED',
          userRole: role
        },
        requiresRefresh: false
      };
    } catch (err) {
      console.error('[Chatbot Error - Check Invoice]:', err);
      return {
        intent: 'CHECK_INVOICE',
        success: false,
        message: `❌ Failed to check invoice: ${err.message}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTENT: APPROVE INVOICE
  // --------------------------------------------------------------------------
  if (parsed.intent === 'APPROVE_INVOICE') {
    // Role Authorization Check:
    // Only REVIEWER or ADMIN can approve invoices
    if (role !== 'REVIEWER' && role !== 'ADMIN') {
      return {
        intent: 'ROLE_DENIED',
        roleDenied: true,
        actionAttempted: 'APPROVE_INVOICE',
        currentRole: role,
        requiredRole: 'REVIEWER or ADMIN',
        message: `⛔ **Authorization Restriction (Active Role: ${role})**\n\n` +
          `You are logged in as **${userName}** with the **${role}** role. ` +
          `Invoice approvals are restricted to **🔍 REVIEWER** or **👑 ADMIN** personnel.\n\n` +
          `• **Why?** Purchaser and Warehouse staff cannot approve financial invoice payouts.\n` +
          `• **How to proceed:** Use the role switcher above to switch to **Priya Reviewer** (or Alex Admin) to approve invoices.`,
        requiresRefresh: false
      };
    }

    try {
      let invRow = null;
      if (parsed.invoiceNumber) {
        const [rows] = await db.query('SELECT * FROM invoices WHERE LOWER(invoice_number) = LOWER(?)', [parsed.invoiceNumber.trim()]);
        invRow = rows[0];
      }

      if (!invRow && parsed.invoiceId) {
        const [rows] = await db.query('SELECT * FROM invoices WHERE id = ?', [parsed.invoiceId]);
        invRow = rows[0];
      }

      // If no invoice number specified, find the most recent pending or matched invoice
      if (!invRow) {
        const [rows] = await db.query(
          "SELECT * FROM invoices WHERE status IN ('PENDING_REVIEW', 'MATCHED', 'UPLOADED') ORDER BY id DESC LIMIT 1"
        );
        invRow = rows[0];
      }

      if (!invRow) {
        return {
          intent: 'APPROVE_INVOICE',
          success: false,
          message: '⚠️ No invoice found to approve. Please specify an invoice number (e.g. *"approve invoice INV-1001"*).'
        };
      }

      if (invRow.status === 'APPROVED') {
        return {
          intent: 'APPROVE_INVOICE',
          success: true,
          message: `ℹ️ Invoice **${invRow.invoice_number}** is already in **APPROVED** status. No further action needed.`
        };
      }

      if (invRow.status === 'BLOCKED') {
        return {
          intent: 'APPROVE_INVOICE',
          success: false,
          message: `⚠️ Invoice **${invRow.invoice_number}** is currently in **BLOCKED** status pending warehouse goods delivery. Please log the delivery first before approving.`
        };
      }

      // Update invoice and exception in DB
      await db.query("UPDATE invoices SET status = 'APPROVED' WHERE id = ?", [invRow.id]);
      await db.query("UPDATE mismatch_exceptions SET status = 'APPROVED' WHERE invoice_id = ?", [invRow.id]);
      await db.query(
        'INSERT INTO approvals(invoice_id, reviewer, decision, comment, decided_at) VALUES (?, ?, ?, ?, NOW())',
        [invRow.id, userName, 'APPROVED', `Approved via AI Copilot by ${userName} (${role})`]
      );
      await db.query(
        'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
        [
          'INVOICE_APPROVED_AI_COPILOT',
          'invoice',
          String(invRow.id),
          `Invoice ${invRow.invoice_number} approved via AI Copilot by ${userName} (${role})`
        ]
      );

      return {
        intent: 'APPROVE_INVOICE',
        success: true,
        message: `✅ **Invoice ${invRow.invoice_number} Approved Successfully!**\n\n` +
          `• **Reviewer:** **${userName}** (\`${role}\`)\n` +
          `• **Decision:** \`APPROVED\`\n` +
          `• **Total Amount Approved:** **₹${Number(invRow.total_amount).toLocaleString('en-IN')}**\n` +
          `• **Decided At:** ${new Date().toLocaleString()}\n\n` +
          `The invoice has been cleared from the Approval Queue and marked for payment disbursement.`,
        data: {
          invoiceId: invRow.id,
          invoiceNumber: invRow.invoice_number,
          status: 'APPROVED',
          reviewer: userName
        },
        requiresRefresh: true
      };
    } catch (err) {
      console.error('[Chatbot Error - Approve Invoice]:', err);
      return {
        intent: 'APPROVE_INVOICE',
        success: false,
        message: `❌ Failed to approve invoice: ${err.message}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTENT: QUERY / STATUS
  // --------------------------------------------------------------------------
  if (parsed.intent === 'QUERY') {
    try {
      if (parsed.poNumber) {
        const tracker = await deliveryGrnAgent.getDeliveryTrackerForPO(parsed.poNumber);
        const p = tracker.po;
        return {
          intent: 'QUERY',
          success: true,
          message: `📋 **Purchase Order Status: ${p.po_number}**\n\n` +
            `• **Vendor:** ${p.vendor_name}\n` +
            `• **Status:** \`${p.status}\`\n` +
            `• **Single GRN:** \`${tracker.singleGrn?.grn_number || 'Pending Dock'}\`\n` +
            `• **Deliveries Count:** ${tracker.deliveriesCount} shipment(s)\n` +
            `• **Ordered Qty:** ${p.total_ordered_quantity}\n` +
            `• **Accepted Qty:** ${p.total_accepted_quantity}\n` +
            `• **Fulfillment:** ${p.fulfillment_percentage}%\n` +
            `• **Invoice Status:** \`${tracker.invoice?.status || 'N/A'}\``,
          data: tracker
        };
      }

      // General query summary
      const [pos] = await db.query('SELECT po_number, status, total_amount FROM purchase_orders ORDER BY id DESC LIMIT 5');
      const poList = pos.map(p => `• \`${p.po_number}\` (${p.status}) - ₹${Number(p.total_amount).toLocaleString('en-IN')}`).join('\n');
      return {
        intent: 'QUERY',
        success: true,
        message: `📋 **Recent Purchase Orders:**\n\n${poList}\n\n` +
          `*Tip: Type "status of PO-1001" or "received 10 laptops for PO-1001" to interact with a specific order.*`
      };
    } catch (err) {
      return {
        intent: 'QUERY',
        success: false,
        message: `Could not retrieve status: ${err.message}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTENT: CHAT / GUIDANCE
  // --------------------------------------------------------------------------
  return {
    intent: 'CHAT',
    success: true,
    message: `👋 Hello **${userName}**! I am your **Autonomous ERP Assistant**.\n\n` +
      `Your current active role is **${role}**.\n\n` +
      (role === 'PURCHASER' || role === 'ADMIN'
        ? `• 🛒 **Buy Items:** Type *"buy 20 laptops"* or *"buy 15 laptops from ABC Supplies"* to automatically generate a Purchase Order.\n`
        : `• 🛒 **Procurement:** Switch to **PURCHASER** to place buy orders.\n`) +
      (role === 'WAREHOUSE' || role === 'ADMIN'
        ? `• 📦 **Log Dock Delivery:** Type *"I had received 15 laptops"* or *"received 10 laptops for PO-1001"* to record warehouse delivery & generate GRN.\n`
        : `• 📦 **Dock Receiving:** Switch to **WAREHOUSE** to record inbound shipments.\n`) +
      `• 📋 **Check Status:** Type *"status of PO-1001"* to inspect order fulfillment.`
  };
}
