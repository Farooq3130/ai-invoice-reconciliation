import { db } from '../config/db.js';
import { askGroq } from '../services/groqService.js';

export function resolvePoItem(inputName, poItems) {
  if (!poItems || !poItems.length) return null;
  const raw = String(inputName || '').trim().toLowerCase();
  if (!raw) return poItems[0];

  // 1. Exact match (case-insensitive)
  const exact = poItems.find(p => p.item_name.trim().toLowerCase() === raw);
  if (exact) return exact;

  // 2. If PO has only 1 item, map to it automatically
  if (poItems.length === 1) return poItems[0];

  // 3. Substring / Prefix match (e.g. "del" matches "Dell UltraSharp 27 Monitor")
  const sub = poItems.find(p => {
    const pn = p.item_name.trim().toLowerCase();
    return pn.includes(raw) || raw.includes(pn);
  });
  if (sub) return sub;

  // 4. Word token overlap match
  const words = raw.split(/\s+/).filter(w => w.length >= 3);
  if (words.length) {
    const tokenMatch = poItems.find(p => {
      const pn = p.item_name.trim().toLowerCase();
      return words.some(w => pn.includes(w));
    });
    if (tokenMatch) return tokenMatch;
  }

  return null;
}

export const deliveryGrnAgent = {
  name: 'Delivery & GRN Agent',

  // Query existing deliveries and GRNs for a PO
  async run(poId) {
    const startTime = Date.now();
    const [deliveries] = await db.query(
      'SELECT id, delivery_number, delivery_date, status FROM deliveries WHERE po_id = ? ORDER BY delivery_date ASC',
      [poId]
    );

    const [grns] = await db.query(
      'SELECT id, delivery_id, grn_number, grn_date, status FROM grns WHERE po_id = ? ORDER BY grn_date ASC',
      [poId]
    );

    const [grnItems] = await db.query(
      `SELECT gi.id, gi.grn_id, gi.item_name, gi.accepted_quantity, gi.delivery_id,
              g.grn_number, COALESCE(d.delivery_number, 'DEL-001') AS delivery_number,
              COALESCE(d.delivery_date, g.grn_date) AS delivery_date
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       LEFT JOIN deliveries d ON d.id = COALESCE(gi.delivery_id, g.delivery_id)
       WHERE g.po_id = ?
       ORDER BY COALESCE(d.delivery_date, g.grn_date) ASC, gi.id ASC`,
      [poId]
    );

    // Group received quantities by item name
    const receivedByItem = {};
    for (const item of grnItems) {
      const name = item.item_name;
      const qty = Number(item.accepted_quantity);
      if (!receivedByItem[name]) {
        receivedByItem[name] = {
          itemName: name,
          totalAcceptedQuantity: 0,
          deliveries: []
        };
      }
      receivedByItem[name].totalAcceptedQuantity += qty;
      receivedByItem[name].deliveries.push({
        deliveryNumber: item.delivery_number,
        grnNumber: item.grn_number,
        deliveryDate: item.delivery_date,
        quantity: qty
      });
    }

    const totalReceived = grnItems.reduce((acc, x) => acc + Number(x.accepted_quantity), 0);

    return {
      agent: this.name,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      data: {
        deliveriesCount: deliveries.length,
        grnsCount: grns.length,
        deliveries,
        grns,
        grnItems: grnItems.map(g => ({
          id: g.id,
          grn_id: g.grn_id,
          grn_number: g.grn_number,
          delivery_id: g.delivery_id,
          delivery_number: g.delivery_number,
          delivery_date: g.delivery_date,
          item_name: g.item_name,
          accepted_quantity: Number(g.accepted_quantity)
        })),
        receivedByItem,
        totalReceived
      }
    };
  },

  // Match an incoming delivery to its PO, inspect quantities, and autonomously generate GRN
  async matchDeliveryAndGenerateGRN({ deliveryNumber, deliveryDate, poNumber, vendor, items, notes }) {
    const startTime = Date.now();

    // 1. Locate matching Purchase Order
    let po = null;
    if (poNumber && poNumber.trim()) {
      const [pos] = await db.query(
        `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
         FROM purchase_orders po
         JOIN vendors v ON v.id = po.vendor_id
         WHERE po.po_number = ?`,
        [poNumber.trim()]
      );
      po = pos[0];
    }

    // If PO not explicitly given, try matching by vendor and item
    if (!po && vendor && items?.length > 0) {
      const [pos] = await db.query(
        `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
         FROM purchase_orders po
         JOIN vendors v ON v.id = po.vendor_id
         JOIN purchase_order_items poi ON poi.po_id = po.id
         WHERE LOWER(v.name) = LOWER(?) AND LOWER(poi.item_name) = LOWER(?)
         ORDER BY po.id DESC LIMIT 1`,
        [vendor.trim(), items[0].item_name.trim()]
      );
      po = pos[0];
    }

    if (!po) {
      throw new Error(`Agent could not match delivery to any valid Purchase Order${poNumber ? ` (${poNumber})` : ''}.`);
    }

    // 2. Fetch existing PO items and past deliveries
    const [poItems] = await db.query(
      'SELECT id, item_name, ordered_quantity, unit_price FROM purchase_order_items WHERE po_id = ?',
      [po.id]
    );

    const [existingGrnItems] = await db.query(
      `SELECT gi.item_name, SUM(gi.accepted_quantity) AS already_received
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       WHERE g.po_id = ?
       GROUP BY gi.item_name`,
      [po.id]
    );

    const receivedMap = {};
    for (const row of existingGrnItems) {
      receivedMap[row.item_name.toLowerCase()] = Number(row.already_received);
    }

    // 3. Generate Delivery Number if not supplied
    const finalDeliveryNumber =
      deliveryNumber && deliveryNumber.trim()
        ? deliveryNumber.trim()
        : `DEL-${Date.now().toString().slice(-5)}`;

    const finalDeliveryDate = deliveryDate ? new Date(deliveryDate) : new Date();

    // Insert Delivery record
    const [delInsert] = await db.query(
      'INSERT INTO deliveries(po_id, delivery_number, delivery_date, status) VALUES (?, ?, ?, ?)',
      [po.id, finalDeliveryNumber, finalDeliveryDate, 'RECEIVED']
    );
    const deliveryId = delInsert.insertId;

    // Record delivery items
    for (const it of items) {
      const name = String(it.item_name || it.itemName || '').trim();
      const qty = Number(it.quantity || it.delivered_quantity || it.deliveredQuantity || 0);
      try {
        await db.query(
          'INSERT INTO delivery_items(delivery_id, item_name, delivered_quantity) VALUES (?, ?, ?)',
          [deliveryId, name, qty]
        );
      } catch (err) {
        // Fallback gracefully if delivery_items is optional
      }
    }

    // 4. Locate or Create the Single GRN for this Purchase Order
    // Each Purchase Order has exactly ONE single GRN number, with multiple deliveries attached to it.
    let [[existingGrn]] = await db.query(
      'SELECT id, grn_number, grn_date, status, inspection_notes FROM grns WHERE po_id = ? LIMIT 1',
      [po.id]
    );

    let grnId = null;
    let finalGrnNumber = '';
    let isInitialGrnForPo = false;

    if (existingGrn) {
      // Re-use the existing single GRN for this PO
      grnId = existingGrn.id;
      finalGrnNumber = existingGrn.grn_number;
    } else {
      // Generate the single official GRN for this Purchase Order
      const [[lastGrn]] = await db.query(
        "SELECT grn_number FROM grns WHERE grn_number LIKE 'GRN-%' ORDER BY id DESC LIMIT 1"
      );
      let nextGrnNum = 1;
      if (lastGrn?.grn_number) {
        const match = lastGrn.grn_number.match(/GRN-(\d+)/);
        if (match) nextGrnNum = parseInt(match[1], 10) + 1;
      }
      finalGrnNumber = `GRN-${String(nextGrnNum).padStart(3, '0')}`;
      isInitialGrnForPo = true;

      // Insert single GRN record for this PO
      const [grnInsert] = await db.query(
        'INSERT INTO grns(po_id, delivery_id, grn_number, grn_date, status) VALUES (?, ?, ?, ?, ?)',
        [po.id, deliveryId, finalGrnNumber, finalDeliveryDate, 'ACCEPTED']
      );
      grnId = grnInsert.insertId;
    }

    // Link this delivery to the PO's single GRN
    try {
      await db.query('UPDATE deliveries SET grn_id = ? WHERE id = ?', [grnId, deliveryId]);
    } catch (err) {}

    // 5. Inspect and accept items into GRN (linked to deliveryId)
    const acceptedItems = [];
    for (const it of items) {
      const rawName = String(it.item_name || it.itemName || '').trim();
      const matchedPoItem = resolvePoItem(rawName, poItems);
      const canonicalName = matchedPoItem ? matchedPoItem.item_name : rawName;
      const qty = Number(it.quantity || it.accepted_quantity || it.delivered_quantity || it.deliveredQuantity || 0);

      try {
        await db.query(
          'INSERT INTO delivery_items(delivery_id, item_name, delivered_quantity) VALUES (?, ?, ?)',
          [deliveryId, canonicalName, qty]
        );
      } catch (err) {}

      try {
        await db.query(
          'INSERT INTO grn_items(grn_id, delivery_id, item_name, accepted_quantity) VALUES (?, ?, ?, ?)',
          [grnId, deliveryId, canonicalName, qty]
        );
      } catch (err) {
        await db.query(
          'INSERT INTO grn_items(grn_id, item_name, accepted_quantity) VALUES (?, ?, ?)',
          [grnId, canonicalName, qty]
        );
      }

      acceptedItems.push({
        item_name: canonicalName,
        accepted_quantity: qty
      });
    }

    // 6. Calculate total deliveries and progress for this PO
    const [[delCountRow]] = await db.query(
      'SELECT COUNT(*) AS total_deliveries FROM deliveries WHERE po_id = ?',
      [po.id]
    );
    const totalDeliveriesDone = delCountRow.total_deliveries;

    // Calculate total accepted so far for each item
    const fulfillmentBreakdown = poItems.map(pItem => {
      const ordered = Number(pItem.ordered_quantity);
      const prior = receivedMap[pItem.item_name.toLowerCase()] || 0;
      const justDelivered = acceptedItems
        .filter(i => i.item_name.trim().toLowerCase() === pItem.item_name.trim().toLowerCase())
        .reduce((sum, x) => sum + Number(x.accepted_quantity), 0);
      const totalRec = prior + justDelivered;
      const remaining = Math.max(0, ordered - totalRec);
      const pct = ordered > 0 ? Math.min(100, Math.round((totalRec / ordered) * 100)) : 100;
      return {
        itemName: pItem.item_name,
        orderedQuantity: ordered,
        priorReceived: prior,
        deliveredThisShipment: justDelivered,
        totalReceivedToDate: totalRec,
        remainingBalance: remaining,
        fulfillmentPercentage: pct
      };
    });

    const isFullyDelivered = fulfillmentBreakdown.every(x => x.remainingBalance === 0);
    const poFulfillmentStatus = isFullyDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
    await db.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [poFulfillmentStatus, po.id]);
    await db.query("UPDATE deliveries SET status = 'ACCEPTED' WHERE id = ?", [deliveryId]);

    // 7. Ask Groq AI for intelligent warehouse receipt narrative
    const promptSystem = `You are a Warehouse Logistics & Quality Inspection AI Agent.
Summarize the receipt of an incoming shipment for a Purchase Order, confirm GRN generation, and report fulfillment progress.
Return JSON:
{
  "summary": string,
  "inspectionStatus": "ACCEPTED" | "ACCEPTED_WITH_CONDITION",
  "fulfillmentNote": string
}`;

    const fallbackSummary = {
      summary: `Delivery ${finalDeliveryNumber} (Shipment #${totalDeliveriesDone}) inspected and received under ${po.po_number}'s GRN ${finalGrnNumber}.`,
      inspectionStatus: 'ACCEPTED',
      fulfillmentNote: isFullyDelivered
        ? `PO ${po.po_number} is now 100% fulfilled across ${totalDeliveriesDone} delivery shipment(s) under single GRN ${finalGrnNumber}.`
        : `PO ${po.po_number} has received shipment #${totalDeliveriesDone} under single GRN ${finalGrnNumber}.`
    };

    const aiRes = await askGroq(
      promptSystem,
      {
        poNumber: po.po_number,
        vendor: po.vendor_name,
        deliveryNumber: finalDeliveryNumber,
        grnNumber: finalGrnNumber,
        shipmentNumber: totalDeliveriesDone,
        itemsDelivered: acceptedItems,
        fulfillmentBreakdown,
        notes: notes || 'Standard receipt'
      },
      fallbackSummary
    );

    const inspectionNotesText = aiRes.data?.summary || fallbackSummary.summary;
    try {
      await db.query('UPDATE grns SET inspection_notes = ? WHERE id = ?', [inspectionNotesText, grnId]);
    } catch (err) {
      console.warn('Could not update grns inspection_notes:', err.message);
    }

    // Audit log
    await db.query(
      'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
      [
        'DELIVERY_GRN_RECORDED',
        'delivery',
        String(deliveryId),
        `Agent logged shipment #${totalDeliveriesDone} (${finalDeliveryNumber}) for ${po.po_number} under single GRN ${finalGrnNumber}`
      ]
    );

    const totalOrderedAll = fulfillmentBreakdown.reduce((sum, x) => sum + x.orderedQuantity, 0);
    const totalAcceptedAll = fulfillmentBreakdown.reduce((sum, x) => sum + x.totalReceivedToDate, 0);
    const overallPct =
      totalOrderedAll > 0 ? Math.min(100, Math.round((totalAcceptedAll / totalOrderedAll) * 100)) : 100;

    return {
      success: true,
      agent: this.name,
      latencyMs: Date.now() - startTime,
      poNumber: po.po_number,
      poStatus: poFulfillmentStatus,
      deliveryCount: totalDeliveriesDone,
      delivery: {
        id: deliveryId,
        deliveryNumber: finalDeliveryNumber,
        delivery_number: finalDeliveryNumber,
        deliveryDate: finalDeliveryDate,
        delivery_date: finalDeliveryDate,
        status: 'ACCEPTED',
        grnNumber: finalGrnNumber,
        grn_number: finalGrnNumber
      },
      grn: {
        id: grnId,
        grnNumber: finalGrnNumber,
        grn_number: finalGrnNumber,
        grnDate: finalDeliveryDate,
        status: 'ACCEPTED',
        inspectionNotes: inspectionNotesText,
        inspection_notes: inspectionNotesText,
        items: acceptedItems
      },
      po: {
        id: po.id,
        poNumber: po.po_number,
        vendorName: po.vendor_name,
        totalDeliveriesDone,
        fulfillmentStatus: poFulfillmentStatus,
        fulfillmentBreakdown
      },
      fulfillment: {
        totalOrdered: totalOrderedAll,
        totalAccepted: totalAcceptedAll,
        fulfillmentPercent: overallPct,
        isFullyDelivered
      },
      aiNarrative: aiRes.data || fallbackSummary
    };
  },

  // Get complete delivery scorecard and history for a specific PO
  async getDeliveryTrackerForPO(poNumber) {
    const [pos] = await db.query(
      `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
       FROM purchase_orders po
       JOIN vendors v ON v.id = po.vendor_id
       WHERE po.po_number = ?`,
      [poNumber]
    );
    if (!pos[0]) throw new Error(`PO '${poNumber}' not found`);
    const po = pos[0];

    const [items] = await db.query(
      'SELECT id, item_name, ordered_quantity, unit_price FROM purchase_order_items WHERE po_id = ?',
      [po.id]
    );

    const [deliveries] = await db.query(
      'SELECT * FROM deliveries WHERE po_id = ? ORDER BY delivery_date ASC',
      [po.id]
    );

    // Fetch the single GRN for this PO
    const [[poGrn]] = await db.query(
      'SELECT * FROM grns WHERE po_id = ? LIMIT 1',
      [po.id]
    );

    // Fetch linked invoice if one has been generated
    const [[poInvoice]] = await db.query(
      'SELECT id, invoice_number, status, total_amount, tax_amount FROM invoices WHERE po_number = ? ORDER BY id DESC LIMIT 1',
      [po.po_number]
    );

    // Fetch returns (RTV) recorded for this PO
    const [poReturns] = await db.query(
      'SELECT * FROM returns WHERE po_id = ? ORDER BY return_date DESC, id DESC',
      [po.id]
    );

    const [grnItems] = await db.query(
      `SELECT gi.*, g.grn_number, COALESCE(d.delivery_number, 'DEL-001') AS delivery_number,
              COALESCE(d.delivery_date, g.grn_date) AS delivery_date
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       LEFT JOIN deliveries d ON d.id = COALESCE(gi.delivery_id, g.delivery_id)
       WHERE g.po_id = ?
       ORDER BY COALESCE(d.delivery_date, g.grn_date) ASC, gi.id ASC`,
      [po.id]
    );

    // Group items received and returned
    const itemStats = items.map(it => {
      const ordered = Number(it.ordered_quantity);
      const matchingItems = grnItems.filter(g => {
        const resolved = resolvePoItem(g.item_name, items);
        const resolvedName = resolved ? resolved.item_name.toLowerCase() : g.item_name.trim().toLowerCase();
        return resolvedName === it.item_name.trim().toLowerCase();
      });
      const matchingReturns = poReturns.filter(r => {
        const resolved = resolvePoItem(r.item_name, items);
        const resolvedName = resolved ? resolved.item_name.toLowerCase() : r.item_name.trim().toLowerCase();
        return resolvedName === it.item_name.trim().toLowerCase();
      });
      const totalAccepted = matchingItems.reduce((sum, g) => sum + Number(g.accepted_quantity), 0);
      const totalReturned = matchingReturns.reduce((sum, r) => sum + Number(r.quantity), 0);
      const remaining = Math.max(0, ordered - totalAccepted);
      const excess = Math.max(0, totalAccepted - ordered);
      const pct = ordered > 0 ? Math.min(100, Math.round((totalAccepted / ordered) * 100)) : 100;
      return {
        itemName: it.item_name,
        orderedQuantity: ordered,
        unitPrice: Number(it.unit_price),
        totalAccepted,
        totalReturned,
        grossAccepted: totalAccepted + totalReturned,
        excessQuantity: excess,
        remaining,
        fulfillmentPercentage: pct,
        deliveriesList: matchingItems.map(g => ({
          deliveryNumber: g.delivery_number,
          deliveryDate: g.delivery_date,
          grnNumber: poGrn?.grn_number || g.grn_number,
          quantity: Number(g.accepted_quantity)
        }))
      };
    });

    const totalOrderedAll = itemStats.reduce((sum, x) => sum + x.orderedQuantity, 0);
    const totalReceivedAll = itemStats.reduce((sum, x) => sum + x.totalAccepted, 0);
    const totalReturnedAll = poReturns.reduce((sum, r) => sum + Number(r.quantity), 0);
    const totalRemainingAll = Math.max(0, totalOrderedAll - totalReceivedAll);
    const totalExcessAll = Math.max(0, totalReceivedAll - totalOrderedAll);

    const overallPct =
      totalOrderedAll > 0 ? Math.min(100, Math.round((totalReceivedAll / totalOrderedAll) * 100)) : 100;

    return {
      poNumber: po.po_number,
      vendorName: po.vendor_name,
      vendor: po.vendor_name,
      orderDate: po.order_date,
      status: po.status,
      poStatus: po.status,
      totalAmount: Number(po.total_amount),
      totalDeliveriesCount: deliveries.length,
      totalOrderedQuantity: totalOrderedAll,
      totalReceivedQuantity: totalReceivedAll,
      totalRemainingQuantity: totalRemainingAll,
      totalReturnedQuantity: totalReturnedAll,
      excessQuantity: totalExcessAll,
      hasExcess: totalExcessAll > 0 || itemStats.some(i => i.excessQuantity > 0),
      overallFulfillmentPercentage: overallPct,
      singleGrnNumber: poGrn?.grn_number || 'PENDING',
      grnNumber: poGrn?.grn_number || 'PENDING',
      grn_number: poGrn?.grn_number || 'PENDING',
      grn_numbers: poGrn ? [poGrn.grn_number] : [],
      invoice: poInvoice || null,
      returns: poReturns.map(r => ({
        id: r.id,
        returnNumber: r.return_number,
        returnDate: r.return_date,
        itemName: r.item_name,
        quantity: Number(r.quantity),
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at
      })),
      summary: {
        totalDeliveries: deliveries.length,
        totalOrderedQuantity: totalOrderedAll,
        totalAcceptedQuantity: totalReceivedAll,
        remainingQuantity: totalRemainingAll,
        returnedQuantity: totalReturnedAll,
        excessQuantity: totalExcessAll,
        hasExcess: totalExcessAll > 0 || itemStats.some(i => i.excessQuantity > 0),
        fulfillmentPercent: overallPct,
        singleGrnNumber: poGrn?.grn_number || 'PENDING',
        grnNumber: poGrn?.grn_number || 'PENDING'
      },
      items: itemStats.map(it => ({
        ...it,
        acceptedQuantity: it.totalAccepted,
        remainingQuantity: it.remaining,
        fulfillmentPercent: it.fulfillmentPercentage,
        status: it.remaining === 0 ? 'DELIVERED' : it.totalAccepted > 0 ? 'PARTIALLY_DELIVERED' : 'OPEN'
      })),
      deliveries: deliveries.map((d, index) => {
        const linkedItems = grnItems.filter(gi => gi.delivery_id === d.id);
        return {
          id: d.id,
          shipmentIndex: index + 1,
          deliveryId: d.id,
          delivery_number: d.delivery_number,
          deliveryNumber: d.delivery_number,
          delivery_date: d.delivery_date,
          deliveryDate: d.delivery_date,
          delivery_status: d.status,
          status: d.status,
          notes: d.notes,
          grn_number: poGrn?.grn_number,
          grnNumber: poGrn?.grn_number,
          items: linkedItems.map(gi => ({
            itemName: gi.item_name,
            acceptedQuantity: Number(gi.accepted_quantity)
          })),
          grns: poGrn ? [{
            id: poGrn.id,
            grn_number: poGrn.grn_number,
            grnNumber: poGrn.grn_number,
            itemName: linkedItems.map(gi => `${gi.item_name} (${Number(gi.accepted_quantity)})`).join(', ') || 'Delivered Goods',
            acceptedQuantity: linkedItems.reduce((acc, gi) => acc + Number(gi.accepted_quantity), 0),
            inspection_notes: poGrn.inspection_notes,
            created_at: poGrn.grn_date
          }] : []
        };
      }),
      grn: poGrn ? {
        id: poGrn.id,
        grn_number: poGrn.grn_number,
        grnNumber: poGrn.grn_number,
        grn_date: poGrn.grn_date,
        status: poGrn.status,
        inspection_notes: poGrn.inspection_notes
      } : null,
      grns: poGrn ? [{
        id: poGrn.id,
        grn_number: poGrn.grn_number,
        grnNumber: poGrn.grn_number,
        item_name: po.vendor_name,
        accepted_quantity: totalReceivedAll,
        inspection_notes: poGrn.inspection_notes,
        created_at: poGrn.grn_date
      }] : []
    };
  },

  // Return excess received items back to vendor (RTV - Return to Vendor)
  async returnExcessItems({ poNumber, invoiceId, itemName, quantity, reason, notes, reviewer }) {
    if (!poNumber) throw new Error('PO Number is required for processing an excess return.');

    // 1. Fetch Purchase Order
    const [pos] = await db.query(
      `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
       FROM purchase_orders po
       JOIN vendors v ON v.id = po.vendor_id
       WHERE po.po_number = ?`,
      [poNumber.trim()]
    );
    const po = pos[0];
    if (!po) throw new Error(`Purchase Order ${poNumber} not found.`);

    // 2. Fetch PO Items
    const [poItems] = await db.query(
      'SELECT id, item_name, ordered_quantity, unit_price FROM purchase_order_items WHERE po_id = ?',
      [po.id]
    );

    // 3. Match Item
    const targetItem = resolvePoItem(itemName, poItems) || poItems[0];
    if (!targetItem) throw new Error(`Could not find line item '${itemName}' on PO ${poNumber}.`);

    const canonicalItemName = targetItem.item_name;
    const orderedQty = Number(targetItem.ordered_quantity);

    // 4. Fetch all grn_items for this item on this PO
    const [grnItems] = await db.query(
      `SELECT gi.*, g.grn_number, g.delivery_id AS g_delivery_id
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       WHERE g.po_id = ? AND LOWER(gi.item_name) = LOWER(?)
       ORDER BY gi.id DESC`,
      [po.id, canonicalItemName]
    );

    const totalAccepted = grnItems.reduce((sum, g) => sum + Number(g.accepted_quantity), 0);
    const excessAvailable = Math.max(0, totalAccepted - orderedQty);

    const qtyToReturn = quantity !== undefined && quantity !== null && Number(quantity) > 0
      ? Number(quantity)
      : (excessAvailable > 0 ? excessAvailable : 0);

    if (qtyToReturn <= 0) {
      throw new Error(
        `Invalid return quantity (${qtyToReturn}). Current accepted: ${totalAccepted} units, ordered: ${orderedQty} units.`
      );
    }

    if (qtyToReturn > totalAccepted) {
      throw new Error(
        `Cannot return ${qtyToReturn} units; only ${totalAccepted} units have been accepted at the warehouse.`
      );
    }

    // 5. Generate unique RTV Return Number
    const returnNumber = `RTV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const returnDate = new Date();
    const returnReason = reason || `Excess over-delivery returned to vendor (Ordered: ${orderedQty}, Accepted: ${totalAccepted}, Returning: ${qtyToReturn})`;

    // Pick delivery_id from most recent grn_item
    const linkedDeliveryId = grnItems[0]?.delivery_id || grnItems[0]?.g_delivery_id || null;

    // 6. Insert Return record
    const [retIns] = await db.query(
      `INSERT INTO returns(po_id, delivery_id, return_number, return_date, item_name, quantity, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RETURNED')`,
      [po.id, linkedDeliveryId, returnNumber, returnDate, canonicalItemName, qtyToReturn, returnReason]
    );

    // 7. Deduct returned quantity from grn_items
    let remainingToDeduct = qtyToReturn;
    for (const gi of grnItems) {
      if (remainingToDeduct <= 0) break;
      const currentQty = Number(gi.accepted_quantity);
      const deductHere = Math.min(currentQty, remainingToDeduct);
      const newQty = currentQty - deductHere;
      await db.query('UPDATE grn_items SET accepted_quantity = ? WHERE id = ?', [newQty, gi.id]);
      remainingToDeduct -= deductHere;
    }

    // 8. Re-evaluate PO Fulfillment Status
    const [allGrnItems] = await db.query(
      `SELECT gi.accepted_quantity
       FROM grn_items gi
       JOIN grns g ON g.id = gi.grn_id
       WHERE g.po_id = ?`,
      [po.id]
    );
    const newTotalAcceptedAll = allGrnItems.reduce((acc, g) => acc + Number(g.accepted_quantity), 0);
    const totalOrderedAll = poItems.reduce((acc, p) => acc + Number(p.ordered_quantity), 0);

    const newPoStatus = newTotalAcceptedAll >= totalOrderedAll
      ? 'DELIVERED'
      : (newTotalAcceptedAll > 0 ? 'PARTIALLY_DELIVERED' : 'OPEN');
    await db.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [newPoStatus, po.id]);

    // 9. Synchronize linked invoices (adjust invoice item if excess was billed)
    const [linkedInvoices] = await db.query(
      'SELECT id, invoice_number, status, total_amount, tax_amount FROM invoices WHERE po_number = ?',
      [po.po_number]
    );

    let updatedReconciliation = null;
    for (const inv of linkedInvoices) {
      const [invItems] = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [inv.id]);
      let invModified = false;
      for (const it of invItems) {
        if (it.item_name.trim().toLowerCase() === canonicalItemName.toLowerCase()) {
          if (Number(it.quantity) > orderedQty) {
            const adjustedQty = Math.max(orderedQty, Number(it.quantity) - qtyToReturn);
            const adjustedLine = adjustedQty * Number(it.unit_price);
            await db.query(
              'UPDATE invoice_items SET quantity = ?, line_total = ? WHERE id = ?',
              [adjustedQty, adjustedLine, it.id]
            );
            invModified = true;
          }
        }
      }

      if (invModified) {
        const [refreshedItems] = await db.query('SELECT line_total FROM invoice_items WHERE invoice_id = ?', [inv.id]);
        const subtotal = refreshedItems.reduce((s, x) => s + Number(x.line_total), 0);
        const tax = Math.round(subtotal * 0.18);
        const total = subtotal + tax;
        await db.query('UPDATE invoices SET tax_amount = ?, total_amount = ? WHERE id = ?', [tax, total, inv.id]);
      }

      // Re-run 3-way reconciliation orchestrator for the invoice
      try {
        const { processInvoice } = await import('../services/orchestratorService.js');
        updatedReconciliation = await processInvoice(inv.id);
      } catch (procErr) {
        console.warn(`[Return Excess] Re-reconciliation notice for invoice ${inv.id}:`, procErr.message);
      }
    }

    // 10. Record Audit Log
    const reviewerName = reviewer || 'Warehouse / Finance Reviewer';
    await db.query(
      'INSERT INTO audit_logs(action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
      [
        'RTV_EXCESS_RETURNED',
        'purchase_order',
        String(po.id),
        `Return to Vendor recorded: ${returnNumber}. Returned ${qtyToReturn} units of ${canonicalItemName} to ${po.vendor_name}. Net accepted: ${totalAccepted - qtyToReturn} units. By: ${reviewerName}`
      ]
    );

    return {
      success: true,
      returnNumber,
      returnId: retIns.insertId,
      poNumber: po.po_number,
      vendor: po.vendor_name,
      itemName: canonicalItemName,
      quantityReturned: qtyToReturn,
      priorAcceptedQuantity: totalAccepted,
      netAcceptedQuantity: totalAccepted - qtyToReturn,
      poStatus: newPoStatus,
      reconciliation: updatedReconciliation
    };
  }
};


