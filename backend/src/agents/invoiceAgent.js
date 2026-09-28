import { askGroq } from '../services/groqService.js';

export const invoiceAgent = {
  name: 'Invoice Processing Agent',
  async run(invoice) {
    // Validate mathematical consistency
    const items = invoice.items || [];
    let calculatedSubtotal = 0;
    const itemValidations = items.map(item => {
      const lineExpected = Number(item.quantity) * Number(item.unit_price);
      const diff = Math.abs(Number(item.line_total) - lineExpected);
      calculatedSubtotal += lineExpected;
      return {
        item_name: item.item_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        line_total: Number(item.line_total),
        math_correct: diff < 0.05
      };
    });

    const taxAmount = Number(invoice.tax_amount || 0);
    const totalAmount = Number(invoice.total_amount || 0);
    const expectedTotal = calculatedSubtotal + taxAmount;
    const totalDiscrepancy = Math.abs(totalAmount - expectedTotal);

    const promptSystem = `You are an expert Accounts Payable AI Invoice Processing Agent.
Analyze the provided invoice data, verify supplier identity, validate math calculations, detect invoice formatting or tax anomalies, and return a structured JSON response.
Required JSON schema:
{
  "extractedData": {
    "invoiceNumber": string,
    "vendorName": string,
    "poNumber": string,
    "invoiceDate": string,
    "subtotal": number,
    "taxAmount": number,
    "totalAmount": number,
    "lineItems": [
      { "item": string, "quantity": number, "unitPrice": number, "lineTotal": number }
    ]
  },
  "validationStatus": "VALID" | "SUSPICIOUS" | "INVALID",
  "confidenceScore": number (0.0 to 1.0),
  "taxRatePercentage": number,
  "summary": string,
  "anomaliesDetected": string[]
}`;

    const fallback = {
      extractedData: {
        invoiceNumber: invoice.invoice_number,
        vendorName: invoice.vendor,
        poNumber: invoice.po_number,
        invoiceDate: invoice.invoice_date,
        subtotal: calculatedSubtotal,
        taxAmount,
        totalAmount,
        lineItems: items.map(i => ({
          item: i.item_name,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          lineTotal: Number(i.line_total)
        }))
      },
      validationStatus: totalDiscrepancy < 0.05 ? 'VALID' : 'SUSPICIOUS',
      confidenceScore: 0.98,
      taxRatePercentage: calculatedSubtotal > 0 ? Math.round((taxAmount / calculatedSubtotal) * 100) : 18,
      summary: `Invoice ${invoice.invoice_number} from ${invoice.vendor} processed with ${items.length} line item(s).`,
      anomaliesDetected: totalDiscrepancy >= 0.05 ? [`Line item sum + tax does not equal invoice total: discrepancy of ${totalDiscrepancy.toFixed(2)}`] : []
    };

    const aiResult = await askGroq(promptSystem, {
      invoiceNumber: invoice.invoice_number,
      vendor: invoice.vendor,
      poNumber: invoice.po_number,
      invoiceDate: invoice.invoice_date,
      taxAmount,
      totalAmount,
      items: itemValidations,
      calculatedSubtotal,
      expectedTotal,
      discrepancy: totalDiscrepancy
    }, fallback);

    return {
      agent: this.name,
      timestamp: new Date().toISOString(),
      mode: aiResult.mode,
      model: aiResult.model,
      latencyMs: aiResult.latencyMs,
      data: aiResult.data || fallback
    };
  }
};

