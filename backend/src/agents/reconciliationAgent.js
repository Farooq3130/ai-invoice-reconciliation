import { askGroq } from '../services/groqService.js';

export const reconciliationAgent = {
  name: 'Reconciliation Agent',
  async run({ invoice, po, grn }) {
    const startTime = Date.now();
    const poData = po?.data || po;
    const grnData = grn?.data || grn;
    const issues = [];
    const itemComparisons = [];

    const invoiceItems = invoice.items || [];
    const poItems = poData?.items || [];
    const receivedByItem = grnData?.receivedByItem || {};

    let totalInvoiceQty = 0;
    let totalPoQty = 0;
    let totalReceivedQty = 0;
    let totalFinancialVariance = 0;

    // 1. PO Existence & Vendor Match
    if (!poData) {
      issues.push({
        type: 'MISSING_PO',
        severity: 'HIGH',
        message: `No corresponding Purchase Order found for PO number '${invoice.po_number}'.`,
        financialImpact: Number(invoice.total_amount)
      });
    } else {
      if (invoice.vendor && poData.vendor_name && invoice.vendor.trim().toLowerCase() !== poData.vendor_name.trim().toLowerCase()) {
        issues.push({
          type: 'VENDOR_MISMATCH',
          severity: 'HIGH',
          message: `Invoice vendor '${invoice.vendor}' does not match PO vendor '${poData.vendor_name}'.`,
          financialImpact: Number(invoice.total_amount)
        });
      }

      // 2. Item-by-Item 3-Way Matching
      for (const invItem of invoiceItems) {
        const invQty = Number(invItem.quantity);
        const invPrice = Number(invItem.unit_price);
        const invLineTotal = Number(invItem.line_total || invQty * invPrice);
        totalInvoiceQty += invQty;

        const poMatch = poItems.find(p => p.item_name.trim().toLowerCase() === invItem.item_name.trim().toLowerCase());
        const grnMatch = receivedByItem[invItem.item_name] ||
          Object.values(receivedByItem).find(g => g.itemName.trim().toLowerCase() === invItem.item_name.trim().toLowerCase());

        const poQty = poMatch ? Number(poMatch.ordered_quantity) : 0;
        const poPrice = poMatch ? Number(poMatch.unit_price) : 0;
        const recQty = grnMatch ? Number(grnMatch.totalAcceptedQuantity) : (grnData?.totalReceived || 0);

        if (poMatch) totalPoQty += poQty;
        totalReceivedQty += recQty;

        const itemComparison = {
          itemName: invItem.item_name,
          invoiceQuantity: invQty,
          poQuantity: poQty,
          receivedQuantity: recQty,
          quantityDifference: invQty - recQty,
          invoiceUnitPrice: invPrice,
          poUnitPrice: poPrice,
          priceDifference: invPrice - poPrice,
          status: 'MATCHED'
        };

        if (!poMatch) {
          issues.push({
            type: 'ITEM_MISMATCH',
            severity: 'HIGH',
            itemName: invItem.item_name,
            message: `Item '${invItem.item_name}' appears on the invoice but was never ordered on PO '${poData.po_number}'.`,
            financialImpact: invLineTotal
          });
          itemComparison.status = 'ITEM_NOT_ON_PO';
          totalFinancialVariance += invLineTotal;
        } else {
          // Check 1: Less Received (Invoiced quantity exceeds verified warehouse dock receipts)
          if (invQty > recQty) {
            const shortQty = invQty - recQty;
            const impact = shortQty * invPrice;
            totalFinancialVariance += impact;
            issues.push({
              type: 'LESS_RECEIVED',
              subType: 'SHORT_DELIVERY',
              severity: 'HIGH',
              itemName: invItem.item_name,
              message: `Less Received (Short Delivery): Invoiced quantity (${invQty}) exceeds verified warehouse received GRN quantity (${recQty}) by ${shortQty} units.`,
              excessQuantity: shortQty,
              financialImpact: impact
            });
            itemComparison.status = 'LESS_RECEIVED';
          }
          // Check 2: More Received (Invoiced quantity or dock received quantity exceeds authorized PO contract)
          else if (invQty > poQty) {
            const overQty = invQty - poQty;
            const impact = overQty * invPrice;
            totalFinancialVariance += impact;
            issues.push({
              type: 'MORE_RECEIVED',
              subType: 'OVER_DELIVERY',
              severity: 'HIGH',
              itemName: invItem.item_name,
              message: `More Received (Over Delivery): Invoiced quantity (${invQty}) exceeds authorized PO contract (${poQty}) by ${overQty} units. Excess must be returned to vendor.`,
              excessQuantity: overQty,
              financialImpact: impact
            });
            itemComparison.status = 'MORE_RECEIVED';
            itemComparison.excessQuantity = overQty;
          } else if (recQty > poQty) {
            const overQty = recQty - poQty;
            const impact = overQty * invPrice;
            totalFinancialVariance += impact;
            issues.push({
              type: 'MORE_RECEIVED',
              subType: 'OVER_DELIVERY',
              severity: 'HIGH',
              itemName: invItem.item_name,
              message: `More Received (Warehouse Over-Receipt): Warehouse received ${recQty} units exceeding authorized PO contract (${poQty}) by ${overQty} units. Excess items must be returned to vendor.`,
              excessQuantity: overQty,
              financialImpact: impact
            });
            itemComparison.status = 'MORE_RECEIVED';
            itemComparison.excessQuantity = overQty;
            itemComparison.note = `Warehouse received ${recQty} units (+${overQty} overage received). Excess must be returned to vendor.`;
          }

          // Check Price Variance
          const priceDiff = invPrice - poPrice;
          if (Math.abs(priceDiff) > 0.01) {
            const priceImpact = Math.abs(priceDiff) * invQty;
            totalFinancialVariance += priceImpact;
            issues.push({
              type: 'PRICE_MISMATCH',
              severity: priceDiff > 0 ? 'HIGH' : 'LOW',
              itemName: invItem.item_name,
              message: `Invoiced unit price (₹${invPrice.toLocaleString()}) differs from agreed PO price (₹${poPrice.toLocaleString()}) by ₹${priceDiff.toLocaleString()}.`,
              priceDifference: priceDiff,
              financialImpact: priceImpact
            });
            if (itemComparison.status === 'MATCHED') {
              itemComparison.status = 'PRICE_MISMATCH';
            }
          }
        }

        itemComparisons.push(itemComparison);
      }

      // 3. Overall Math & Tax Validation
      const calculatedInvoiceTotal = invoiceItems.reduce(
        (sum, it) => sum + Number(it.quantity) * Number(it.unit_price),
        0
      ) + Number(invoice.tax_amount || 0);

      const totalDiscrepancy = Math.abs(Number(invoice.total_amount) - calculatedInvoiceTotal);
      if (totalDiscrepancy > 0.05) {
        issues.push({
          type: 'AMOUNT_MISMATCH',
          severity: 'MEDIUM',
          message: `Invoice grand total (₹${Number(invoice.total_amount).toLocaleString()}) does not match line items total plus tax (₹${calculatedInvoiceTotal.toLocaleString()}). Difference: ₹${totalDiscrepancy.toFixed(2)}.`,
          financialImpact: totalDiscrepancy
        });
      }
    }

    const isMatch = issues.length === 0;
    const matchStatus = isMatch ? 'MATCHED' : 'MISMATCH';

    const hasLessReceived = issues.some(i => i.type === 'LESS_RECEIVED');
    const hasMoreReceived = issues.some(i => i.type === 'MORE_RECEIVED');
    const hasPriceMismatch = issues.some(i => i.type === 'PRICE_MISMATCH');

    let matchClassification = 'MATCHED';
    let matchLabel = '3-Way Matched';
    if (hasLessReceived) {
      matchClassification = 'LESS_RECEIVED';
      matchLabel = 'Less Received (Short Delivery)';
    } else if (hasMoreReceived) {
      matchClassification = 'MORE_RECEIVED';
      matchLabel = 'More Received (Over Delivery)';
    } else if (hasPriceMismatch) {
      matchClassification = 'PRICE_MISMATCH';
      matchLabel = 'Price Variance Detected';
    } else if (!isMatch) {
      matchClassification = 'MISMATCH';
      matchLabel = 'Discrepancy Detected';
    }

    // Invoke Groq for intelligent executive matching summary
    const promptSystem = `You are a Senior Financial Controller AI in Accounts Payable.
Analyze the 3-way reconciliation outcome between Invoice, Purchase Order, and Delivery/GRN.
Match Classification: ${matchClassification} (${matchLabel}).
Return JSON with this schema:
{
  "verdict": "MATCHED" | "MISMATCH",
  "executiveSummary": string,
  "financialVarianceAssessment": string,
  "confidenceScore": number (0.0 to 1.0)
}`;

    const fallbackSummary = {
      verdict: matchStatus,
      executiveSummary: isMatch
        ? `All three-way matching criteria passed for Invoice ${invoice.invoice_number}. Vendor, line items, unit prices, and delivered quantities align fully.`
        : `Three-way matching detected ${issues.length} discrepancy(ies) (${matchLabel}) on Invoice ${invoice.invoice_number}. Human review and resolution required.`,
      financialVarianceAssessment: totalFinancialVariance > 0
        ? `Total potential financial exposure: ₹${totalFinancialVariance.toLocaleString()}`
        : 'Zero financial exposure detected.',
      confidenceScore: 0.99
    };

    const aiSummary = await askGroq(promptSystem, {
      invoiceNumber: invoice.invoice_number,
      vendor: invoice.vendor,
      poNumber: invoice.po_number,
      totalAmount: invoice.total_amount,
      issuesCount: issues.length,
      matchClassification,
      matchLabel,
      issues,
      itemComparisons,
      totalFinancialVariance
    }, fallbackSummary);

    return {
      status: matchStatus,
      matchClassification,
      matchLabel,
      issues,
      itemComparisons,
      poQuantity: totalPoQty || (poData?.items?.[0] ? Number(poData.items[0].ordered_quantity) : 0),
      receivedQuantity: totalReceivedQty || (grnData?.totalReceived || 0),
      invoiceQuantity: totalInvoiceQty || (invoiceItems[0] ? Number(invoiceItems[0].quantity) : 0),
      difference: (totalInvoiceQty || 0) - (totalReceivedQty || 0),
      totalFinancialVariance,
      aiSummary: aiSummary.data || fallbackSummary,
      aiMode: aiSummary.mode,
      latencyMs: Date.now() - startTime
    };
  }
};

