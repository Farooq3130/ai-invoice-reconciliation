import { askGroq } from '../services/groqService.js';

export const exceptionAgent = {
  name: 'Exception Agent',
  async run(result) {
    const issues = result.issues || [];
    if (!issues.length) {
      return {
        agent: this.name,
        timestamp: new Date().toISOString(),
        data: {
          type: 'NONE',
          severity: 'LOW',
          explanation: 'No exceptions or mismatches detected during 3-way matching.',
          recommendedAction: 'Approve invoice for payment processing.',
          suggestedDecision: 'APPROVE'
        }
      };
    }

    const primaryType = issues.length === 1 ? issues[0].type : 'MULTI_DISCREPANCY';
    const hasHighSeverity = issues.some(i => i.severity === 'HIGH' || i.severity === 'CRITICAL');
    const computedSeverity = hasHighSeverity ? 'HIGH' : 'MEDIUM';

    const fallbackExplanation = issues.map(i => `• ${i.message}`).join('\n');
    let fallbackAction = 'Review source documents and verify warehouse goods receipt records before approving.';
    if (issues.some(i => i.type === 'QUANTITY_MISMATCH')) {
      fallbackAction = 'Invoice quantity exceeds goods received. Contact warehouse to confirm if a subsequent delivery is pending, or request a credit note from the vendor.';
    } else if (issues.some(i => i.type === 'PRICE_MISMATCH')) {
      fallbackAction = 'Invoice unit price exceeds PO price. Escalate to procurement manager for price variance authorization or request corrected invoice.';
    } else if (issues.some(i => i.type === 'VENDOR_MISMATCH')) {
      fallbackAction = 'Vendor mismatch detected. Verify vendor tax ID and contract before approving.';
    }

    const fallback = {
      type: primaryType,
      severity: computedSeverity,
      explanation: fallbackExplanation,
      financialImpact: `Financial exposure: ₹${(result.totalFinancialVariance || 0).toLocaleString()}`,
      recommendedAction: fallbackAction,
      suggestedDecision: hasHighSeverity ? 'REJECT' : 'APPROVE_WITH_NOTE'
    };

    const promptSystem = `You are an Accounts Payable Audit & Compliance AI Specialist.
Analyze the following reconciliation discrepancy report between Invoice, Purchase Order, and GRNs.
Provide a clear, plain-language business diagnosis of the root cause, quantify the financial exposure, and provide actionable next steps for the finance reviewer.
Return JSON with this schema:
{
  "type": "${primaryType}",
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "explanation": string,
  "financialImpact": string,
  "recommendedAction": string,
  "suggestedDecision": "REJECT" | "HOLD_FOR_DELIVERY" | "REQUEST_CREDIT_NOTE" | "APPROVE_WITH_DEVIATION"
}`;

    const aiResult = await askGroq(promptSystem, {
      issuesCount: issues.length,
      issues,
      itemComparisons: result.itemComparisons,
      poQuantity: result.poQuantity,
      receivedQuantity: result.receivedQuantity,
      invoiceQuantity: result.invoiceQuantity,
      difference: result.difference,
      financialVariance: result.totalFinancialVariance
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

