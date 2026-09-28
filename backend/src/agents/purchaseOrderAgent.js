import { db } from '../config/db.js';

export const purchaseOrderAgent = {
  name: 'Purchase Order Agent',
  async run(poNumber) {
    const startTime = Date.now();
    const [rows] = await db.query(
      `SELECT po.*, v.name AS vendor_name, v.code AS vendor_code
       FROM purchase_orders po
       JOIN vendors v ON v.id = po.vendor_id
       WHERE po.po_number = ?`,
      [poNumber]
    );

    if (!rows[0]) {
      return {
        agent: this.name,
        timestamp: new Date().toISOString(),
        status: 'NOT_FOUND',
        poNumber,
        latencyMs: Date.now() - startTime,
        data: null,
        message: `Purchase Order ${poNumber} could not be located in ERP database.`
      };
    }

    const po = rows[0];
    const [items] = await db.query(
      'SELECT id, item_name, ordered_quantity, unit_price FROM purchase_order_items WHERE po_id = ?',
      [po.id]
    );

    const totalOrderedQty = items.reduce((acc, item) => acc + Number(item.ordered_quantity), 0);
    const calculatedSubtotal = items.reduce(
      (acc, item) => acc + Number(item.ordered_quantity) * Number(item.unit_price),
      0
    );

    return {
      agent: this.name,
      timestamp: new Date().toISOString(),
      status: 'FOUND',
      latencyMs: Date.now() - startTime,
      data: {
        id: po.id,
        po_number: po.po_number,
        vendor_id: po.vendor_id,
        vendor_name: po.vendor_name,
        vendor_code: po.vendor_code,
        status: po.status,
        order_date: po.order_date,
        total_amount: Number(po.total_amount),
        calculated_subtotal: calculatedSubtotal,
        total_ordered_quantity: totalOrderedQty,
        items: items.map(it => ({
          id: it.id,
          item_name: it.item_name,
          ordered_quantity: Number(it.ordered_quantity),
          unit_price: Number(it.unit_price),
          line_total: Number(it.ordered_quantity) * Number(it.unit_price)
        }))
      }
    };
  }
};

