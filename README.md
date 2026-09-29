
Your local text or project files
=======
# ai-invoice-reconciliation
>>>>>>> origin/main

# AI Invoice, Purchase Order & GRN Reconciliation System (Live Working Model)

A full-stack autonomous three-way matching application for enterprise accounts payable. Built with React (Vite) in the frontend, Express and MySQL in the backend, and powered by live Groq LPU inference (`openai/gpt-oss-120b`).

---

## Key Features

- **Live AI Agents (Groq LPU Acceleration)**:
  - **Invoice Processing Agent**: Mathematically verifies line item totals, tax calculations, and detects invoice anomalies.
  - **Purchase Order Agent**: Retrieves ERP contracts, items, and validates active order commitments.
  - **Delivery & GRN Agent**: Accurately handles split deliveries (e.g. `DEL-001: 75` + `DEL-002: 25` = 100 received).
  - **Reconciliation Engine**: Performs authoritative item-by-item quantity, unit price, and total amount 3-way checks.
  - **Exception Agent**: Evaluates discrepancies, computes financial exposure, and produces business root-cause diagnoses and recommendations.
- **Human-in-the-Loop Governance**:
  - Reviewer decision modals for approval/rejection with custom audit justifications.
  - Exception queue categorized by severity (`CRITICAL`, `HIGH`, `MEDIUM`).
- **Resilient Ingestion**:
  - Single invoice upload with preset templates.
  - Bulk Excel (`.xlsx`/`.xls`) and CSV (`.csv`) import with independent row processing.
  - Downloadable sample CSV templates.
- **Purchase Order & Delivery Management**:
  - **Create Purchase Order Only**: Dedicated UI and API to establish ERP Purchase Orders with line items, quantities, and pricing.
  - **Log Inbound Deliveries Directly**: Intake delivery shipments with carrier and dock notes.
  - **Autonomous Agent GRN Generation**: AI Fulfillment Agent automatically matches incoming shipments against target POs, generates sequential GRNs (`GRN-XXX`), synthesizes warehouse quality inspection notes, and updates PO fulfillment status (`PARTIALLY_DELIVERED` vs `DELIVERED`).
  - **Per-PO Delivery Tracker & Scorecard**: Interactive scorecard displaying total shipments received, cumulative accepted vs ordered quantities, remaining balance, visual progress bars, and item-by-item breakdown.
- **Multi-User Role-Based Access Control (RBAC)**:
  - **👑 Admin (`admin@example.com` / `demo123`)**: Full unrestricted system access across all modules (Purchase Orders, Invoices, Inbound Deliveries, Approval Queue, Batches, Audit History, and Database Reset).
  - **🛒 Purchaser (`purchaser@example.com` / `demo123`)**: Procurement authority. Create Purchase Orders with line items, upload vendor bills/invoices, inspect 3-way match results, and track delivery progress against ordered quantities.
  - **📦 Warehouse (`warehouse@example.com` / `demo123`)**: Dock logistics authority. Log incoming physical shipments, record inspected quantities received, trigger AI sequential GRN issuance, and view inbound PO requirements. Restricted from financial invoices and PO creation.
  - **1-Click Role Switcher**: Instant role selection tiles on the login screen for testing each persona seamlessly.
- **Search & Filtering**:
  - Instant search across invoice numbers, PO numbers, and vendor names.
  - Status filters (`All`, `Uploaded`, `Matched`, `Pending Review`, `Approved`, `Rejected`).
- **Audit & Reset**:
  - Complete chronological audit log of all system actions.
  - One-click **Reset Test Data** (`POST /api/system/reset-demo`) for repeatable testing.

---

## Requirements

- **Node.js 18+** & **npm**
- **MySQL 8+** (running on `localhost:3306`)
- **Groq API Key** (configured in `backend/.env`)

---

## Quick Start

### 1. Database Setup
Ensure MySQL is running and execute:

```sql
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

### 2. Backend Setup
```bash
cd backend
npm install
npm run dev
```
*API runs at `http://localhost:5000` with live Groq inference enabled.*

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
*Web application runs at `http://localhost:5173`.*

---

## Verification Test Cases

| ID | Test Scenario | Steps | Expected Result |
|---|---|---|---|
| **TC-01** | Open Workspace | Open `http://localhost:5173`, select **Alex Admin** (`admin@example.com` / `demo123`) | Dashboard displays live KPIs, active Groq AI model badge, and pipeline stages. |
| **TC-02** | 3-Way Matched Invoice | Open **Invoices** → Click `INV-1001` → Click **Run AI Agents** | PO, split GRN total (75 + 25 = 100), and invoice align; status becomes `MATCHED`. |
| **TC-03** | Quantity Mismatch | Open **Invoices** → Click `INV-1006` → Click **Run AI Agents** | Result is `MISMATCH` (120 invoiced vs 100 received); AI Exception Agent quantifies financial impact. |
| **TC-04** | Approval Flow | In `INV-1006` or **Approval Queue**, click **Approve** or **Reject** | Reviewer comment modal opens; decision is written to `approvals` and `audit_logs`. |
| **TC-05** | Split GRN Traceability | In `INV-1001` or **Deliveries & GRNs** | View unique delivery records `DEL-001` and `DEL-002` summing to the PO total. |
| **TC-06** | Bulk Import | Go to **Bulk Upload** → Download Sample CSV → Upload | Creates resilient processing batch; rows are individually reconciled. |
| **TC-07** | Search & Filter | In **Invoices**, type `INV-1001` or `ABC Supplies` | Real-time table filtering displays matching records. |
| **TC-08** | Audit History | Go to **Audit History** | Review immutable chronological logs for processing, approvals, and logins. |
| **TC-09** | Reset Test Data | Click **↺ Reset Test Data** in header/sidebar (Admin only) | Database seed resets cleanly back to initial `UPLOADED` state. |
| **TC-10** | Create Purchase Order Only | Go to **Purchase Orders** → Click **+ Create Purchase Order** | Enter PO #, vendor, order date, and line items. Order is saved with status `OPEN` and 0 deliveries. |
| **TC-11** | Log Delivery & Auto-GRN | Go to **Deliveries & GRNs** → Click **+ Log Incoming Delivery** | AI Agent matches shipment to PO, generates official sequential GRN (e.g. `GRN-020`), synthesizes inspection notes, and updates PO status. |
| **TC-12** | Per-PO Delivery Tracker | In **Purchase Orders** or **Deliveries**, click **Track Deliveries** | Opens comprehensive scorecard modal showing total shipments completed, fulfillment progress bar, item-level breakdown, and linked GRNs. |
| **TC-13** | Admin Role Persona | Sign in as `admin@example.com` (`demo123`) | Unrestricted access to POs, Invoices, Deliveries, Approvals, Batches, Audit, and DB Reset. |
| **TC-14** | Purchaser Role Persona | Sign in as `purchaser@example.com` (`demo123`) | Can create POs, upload invoices, view 3-way match, and monitor delivery fulfillment; cannot log dock deliveries or approve exceptions. |
| **TC-15** | Warehouse Role Persona | Sign in as `warehouse@example.com` (`demo123`) | Can log inbound deliveries, generate GRNs, and view PO delivery trackers; invoices, approvals, and PO creation are hidden/restricted. |

---

## API Endpoints

- `GET /api/health` - Health check & live Groq AI status
- `POST /api/auth/login` - Reviewer login
- `GET /api/dashboard/stats` - Live KPIs and counts
- `GET /api/vendors` - Registered ERP vendors
- `GET /api/invoices` - Invoices list (supports `?search=` and `?status=`)
- `GET /api/invoices/:id` - Detailed invoice with 3-way comparisons and agent logs
- `POST /api/invoices/:id/process` - Executes 5-stage AI agent pipeline
- `POST /api/invoices/upload` - Single invoice upload
- `POST /api/invoices/bulk-upload` - Resilient multi-row spreadsheet batch ingestion
- `GET /api/invoices/template/sample` - Downloadable sample CSV
- `GET /api/exceptions` - Pending review approval queue
- `POST /api/invoices/:id/approve` - Approve invoice with reviewer justification
- `POST /api/invoices/:id/reject` - Reject invoice with reason code
- `GET /api/purchase-orders` - Purchase orders with cumulative delivery counts and quantities
- `POST /api/purchase-orders` - Create standalone Purchase Order with line items
- `GET /api/purchase-orders/:poNumber/delivery-tracker` - Comprehensive delivery scorecard and shipment history for a PO
- `GET /api/deliveries` - Inbound delivery shipments with linked GRNs
- `POST /api/deliveries` - Log delivery shipment and trigger autonomous Agent GRN generation
- `GET /api/deliveries/summary-by-po` - Consolidated delivery scorecards grouped across all POs
- `GET /api/batches` - Batch processing history
- `GET /api/audit-logs` - Audit trail

- `POST /api/system/reset-demo` - 1-click test data reset

=======
# ai-invoice-reconciliation
>>>>>>> 5c79c99b18fc845dfca36efdd144f7371df77807
