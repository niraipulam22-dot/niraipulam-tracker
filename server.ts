import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = (() => {
  const envPort = process.env.PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return 3000;
})();

// In-memory cache map for sheet data keyed by sheet ID
interface Cache {
  data: any[];
  rawCsv: string;
  lastUpdated: string;
}

const cacheMap = new Map<string, Cache>();

// Helper to check if cache is stale for a specific sheet ID (12 hours = 43200000 ms)
const CACHE_DURATION_MS = 12 * 60 * 60 * 1000;

function isCacheStale(sheetId: string): boolean {
  const cached = cacheMap.get(sheetId);
  if (!cached) return true;
  const elapsed = Date.now() - new Date(cached.lastUpdated).getTime();
  return elapsed > CACHE_DURATION_MS;
}

// Robust CSV parser
function parseCSV(csvText: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(cell.trim());
      if (row.length > 0 && row.some(c => c !== "")) {
        result.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c !== "")) {
      result.push(row);
    }
  }
  return result;
}

// Helper to compute a header-match score for a given row
function getHeaderScore(row: string[]): number {
  if (!row) return 0;
  let score = 0;
  const keywords = [
    "date", "day", "sl.no", "sl no", "daily",
    "good", "item", "product", "particulars", "fruit", "veggie", "vegetable", "category",
    "ordered", "order volume", "ordered volume", "ordered weight", "ordered qty", "ordered quantity",
    "delivered", "delivered volume", "delivered weight", "delivered qty", "delivered quantity", "actual qty",
    "price", "rate", "unit price", "selling price",
    "paid", "amount paid", "paid amount",
    "revenue", "delivered value", "value",
    "due", "balance", "outstanding", "pending"
  ];
  row.forEach(cell => {
    const norm = cell.toLowerCase().trim();
    if (norm && keywords.some(k => norm.includes(k))) {
      score++;
    }
  });
  return score;
}

// Standardize spreadsheet row fields using fuzzy header matching with dynamic row detection
function processSheetData(rows: string[][]): any[] {
  if (rows.length < 1) return [];

  // Dynamically detect header row by scoring rows 0 through 4 (skips any decorative or merged title rows)
  let headerRowIdx = 0;
  let maxScore = getHeaderScore(rows[0]);

  const rowsToCheck = Math.min(5, rows.length);
  for (let r = 1; r < rowsToCheck; r++) {
    const score = getHeaderScore(rows[r]);
    if (score > maxScore) {
      maxScore = score;
      headerRowIdx = r;
    }
  }

  console.log(`[processSheetData] Header row detected at index: ${headerRowIdx} (score: ${maxScore})`);
  
  const headers = rows[headerRowIdx].map(h => h.toLowerCase().trim());
  const parsedRows: any[] = [];

  // Helper matching indices
  const findIndex = (keywords: string[], defaultIdx: number): number => {
    const idx = headers.findIndex(h => keywords.some(k => h.includes(k)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const dateIdx = findIndex(["date", "day", "sl.no", "sl no", "daily"], 1);
  const poQtyIdx = findIndex(["po qty", "order qty", "ordered qty"], 4);
  const poValueIdx = findIndex(["po value", "order value", "booking value", "booked value"], 5);
  const deliveryQtyIdx = findIndex(["delivery quantity", "delivery qty", "delivered qty", "actual qty"], 6);
  const deliveryValueIdx = findIndex(["delivery value", "delivered value", "actual value"], 7);
  const paymentStatusIdx = findIndex(["payment status", "payment_status", "status"], 9);
  const paymentRefIdx = findIndex(["payment ref", "payment_ref", "reference", "utr"], 10);
  const paymentDateIdx = findIndex(["payment date", "paid date", "date of payment"], 11);
  const paymentValueIdx = findIndex(["payment value", "amount received", "payments received", "paid value", "payment amount"], 12);
  const commentsIdx = findIndex(["comments", "comment"], 13);

  console.log(`[processSheetData] Matched Indices:`, {
    dateIdx,
    poQtyIdx,
    poValueIdx,
    deliveryQtyIdx,
    deliveryValueIdx,
    paymentStatusIdx,
    paymentRefIdx,
    paymentDateIdx,
    paymentValueIdx,
    commentsIdx
  });

  const cleanNum = (val: string | undefined): number => {
    if (!val) return 0;
    const trimmed = val.trim().toLowerCase();
    // Handle "Nil" / "Nil value" as zero for context
    if (trimmed === "nil" || trimmed === "nill" || trimmed === "null" || trimmed === "" || trimmed === "-") {
      return 0;
    }
    // Strip Rs., Rupees, Dollar $, Rupee ₹, spaces, commas
    const cleaned = trimmed.replace(/rs\.?|rupees|\$|₹|\s|,/gi, "");
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Intermediate helper representing raw rows
  interface RawRowData {
    r: number;
    date: string;
    poQty: number;
    poValue: number;
    deliveryQty: number;
    deliveryValue: number;
    paymentStatus: string;
    paymentRef: string;
    paymentDate: string;
    paymentValue: number;
    comment: string;
  }

  const rawRows: RawRowData[] = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || row.every(val => val === "")) continue;

    const rawDate = dateIdx !== -1 && row[dateIdx] ? row[dateIdx].trim() : "";
    if (!rawDate || rawDate.toLowerCase() === "date" || rawDate.toLowerCase() === "nil" || rawDate.toLowerCase().includes("total")) continue;

    const rowPoQty = poQtyIdx !== -1 ? cleanNum(row[poQtyIdx]) : 0;
    const rowPoValue = poValueIdx !== -1 ? cleanNum(row[poValueIdx]) : 0;
    const rowDeliveryQty = deliveryQtyIdx !== -1 ? cleanNum(row[deliveryQtyIdx]) : 0;
    const rowDeliveryValue = deliveryValueIdx !== -1 ? cleanNum(row[deliveryValueIdx]) : 0;
    const rowPaymentValue = paymentValueIdx !== -1 ? cleanNum(row[paymentValueIdx]) : 0;
    const paymentStatus = paymentStatusIdx !== -1 && row[paymentStatusIdx] ? row[paymentStatusIdx].trim() : "";
    const paymentRef = paymentRefIdx !== -1 && row[paymentRefIdx] ? row[paymentRefIdx].trim() : "";
    const paymentDate = paymentDateIdx !== -1 && row[paymentDateIdx] ? row[paymentDateIdx].trim() : "";
    const comment = commentsIdx !== -1 && row[commentsIdx] ? row[commentsIdx].trim() : "";

    rawRows.push({
      r,
      date: rawDate,
      poQty: rowPoQty,
      poValue: rowPoValue,
      deliveryQty: rowDeliveryQty,
      deliveryValue: rowDeliveryValue,
      paymentStatus,
      paymentRef,
      paymentDate,
      paymentValue: rowPaymentValue,
      comment
    });
  }

  // Pass 2: Group consecutive/merged weekend payments
  const groupIds = new Array<string>(rawRows.length).fill("");
  let groupCounter = 0;

  for (let i = 0; i < rawRows.length; i++) {
    if (groupIds[i] !== "") continue;

    const currentId = `g-${groupCounter++}`;
    groupIds[i] = currentId;

    const current = rawRows[i];

    // Check if current row represents a Completed group leader
    if (current.paymentStatus === "Completed" && current.paymentValue > 0) {
      let j = i + 1;
      while (j < rawRows.length) {
        const next = rawRows[j];

        // If next row has its own raw payment value, it's a new group leader
        if (next.paymentValue > 0) {
          break;
        }

        // If next row is not completed/delivered, we stop grouping
        if (next.paymentStatus !== "Completed" && next.paymentStatus !== "") {
          break;
        }

        const isSameRef = current.paymentRef !== "" && next.paymentRef !== "" && current.paymentRef === next.paymentRef;
        const isMergedEmpty = next.paymentValue === 0 && next.paymentRef === "" && next.paymentStatus === "Completed";
        const isWithinWindow = (j - i) <= 3; // consecutive weekend spacing

        if (isSameRef || (isMergedEmpty && isWithinWindow)) {
          groupIds[j] = currentId;
          j++;
        } else {
          break;
        }
      }
    }
  }

  // Pass 3: Pre-calculate carry-over payments and custom outstanding balances for each raw row.
  // When cells in Column M are merged in Google Sheets, only the first row has the raw payment value
  // and subsequent rows show 0. We carry over any excess payment to adjacent rows sequentially in sheet order
  // until the excess is less than a four-digit number (< 1000 INR, i.e. remaining transaction fee).
  const adjustedPayments = new Array<number>(rawRows.length).fill(0);
  const outstandingAmounts = new Array<number>(rawRows.length).fill(0);

  let excessPayment = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const delivery = r.deliveryValue;
    const payment = r.paymentValue;

    let currentPayment = payment;
    let carriedPaid = 0;

    if (payment === 0 && excessPayment >= 1000) {
      carriedPaid = excessPayment;
      currentPayment = carriedPaid;
    }

    // Determine outstanding: Column H (deliveryValue) has value but Column M (adjusted currentPayment) has no value.
    const hasDeliveryValue = delivery > 0;
    const hasPaymentValue = currentPayment > 0;

    let outstanding = 0;
    if (hasDeliveryValue && !hasPaymentValue) {
      outstanding = delivery;
    } else {
      outstanding = 0;
    }

    outstandingAmounts[i] = outstanding;

    if (payment > 0) {
      excessPayment = payment - delivery;
    } else if (carriedPaid > 0) {
      excessPayment = carriedPaid - delivery;
    } else {
      excessPayment = 0;
    }

    if (excessPayment < 1000) {
      excessPayment = 0;
    }

    adjustedPayments[i] = currentPayment;
  }

  // Pass 4: Process financial values per group and distribute to commodities
  // Group row lookups by groupId
  const groupsMap = new Map<string, RawRowData[]>();
  rawRows.forEach((row, idx) => {
    const gid = groupIds[idx] || `single-${idx}`;
    if (!groupsMap.has(gid)) {
      groupsMap.set(gid, []);
    }
    groupsMap.get(gid)!.push(row);
  });

  rawRows.forEach((row, idx) => {
    const gid = groupIds[idx] || `single-${idx}`;
    const groupRows = groupsMap.get(gid) || [row];

    const groupTotalDeliveryValue = groupRows.reduce((s, r) => s + r.deliveryValue, 0);
    const groupTotalPaymentValue = groupRows.reduce((s, r) => s + r.paymentValue, 0);

    const isPaid = groupRows.some(r => r.paymentStatus === "Completed");
    const unpaidGap = groupTotalDeliveryValue - groupTotalPaymentValue;
    
    // "Also if Payment values are less than delivered values by less than four digits
    // then they are just transaction fee and cant be counted as overdue."
    // 4 digits => < 1000 INR
    const isTransactionFee = isPaid && groupTotalPaymentValue > 0 && unpaidGap > 0 && unpaidGap < 1000;

    // Parse commodities from the comment cell
    // Format: "Ice Apple (146/250), Jackfruit (0/100)"
    const items: { goodName: string; delivered: number; ordered: number }[] = [];
    const comment = row.comment;

    if (comment && comment !== "NIL" && comment !== "Not Delivered") {
      const parts = comment.split(",");
      for (const part of parts) {
        const match = part.trim().match(/^([^(]+)\s*\((\d+)\/(\d+)\)$/);
        if (match) {
          items.push({
            goodName: match[1].trim(),
            delivered: parseInt(match[2], 10),
            ordered: parseInt(match[3], 10)
          });
        } else {
          // Alternative regex for embedded parts
          const altRegex = /([a-zA-Z\s]+)\s*\((\d+)\/(\d+)\)/g;
          let m;
          while ((m = altRegex.exec(part)) !== null) {
            items.push({
              goodName: m[1].trim(),
              delivered: parseInt(m[2], 10),
              ordered: parseInt(m[3], 10)
            });
          }
        }
      }
    }

    if (items.length > 0) {
      const totalOrderedQty = items.reduce((sum, item) => sum + item.ordered, 0);
      const totalDeliveredQty = items.reduce((sum, item) => sum + item.delivered, 0);

      items.forEach((item, index) => {
        const orderedRatio = totalOrderedQty > 0 ? (item.ordered / totalOrderedQty) : (1 / items.length);

        const itemOrderedVolume = item.ordered;
        const itemDeliveredVolume = item.delivered;
        const itemOrderedValue = row.poValue * orderedRatio;
        const itemDeliveredValue = totalDeliveredQty > 0 ? row.deliveryValue * (item.delivered / totalDeliveredQty) : (row.deliveryValue / items.length);

        const rowOutstanding = outstandingAmounts[idx];
        const rowPaidAdjusted = adjustedPayments[idx];

        const rowSplitPayment = groupTotalPaymentValue / groupRows.length;
        const itemSplitPaidAmount = totalDeliveredQty > 0 
          ? rowSplitPayment * (item.delivered / totalDeliveredQty) 
          : (rowSplitPayment * orderedRatio);

        const itemBalancePayment = totalDeliveredQty > 0 
          ? rowOutstanding * (item.delivered / totalDeliveredQty) 
          : (rowOutstanding / items.length);

        const itemPaidAmount = totalDeliveredQty > 0 
          ? rowPaidAdjusted * (item.delivered / totalDeliveredQty) 
          : (rowPaidAdjusted * orderedRatio);

        const unitPrice = itemOrderedVolume > 0 ? (itemOrderedValue / itemOrderedVolume) : 0;
        const potentialLoss = Math.max(0, itemOrderedValue - itemDeliveredValue);

        parsedRows.push({
          id: `row-${row.r}-${index}`,
          date: row.date,
          good: item.goodName,
          orderedVolume: itemOrderedVolume,
          deliveredVolume: itemDeliveredVolume,
          unitPrice,
          paidAmount: itemPaidAmount,
          splitPaidAmount: itemSplitPaidAmount,
          orderedValue: itemOrderedValue,
          deliveredValue: itemDeliveredValue,
          potentialLoss,
          balancePayment: itemBalancePayment,
          rawRow: [row.date, item.goodName, row.comment]
        });
      });
    } else {
      let goodName = "General Agroproducts";
      if (row.poValue === 0 && row.deliveryValue === 0) {
        goodName = "General Agroproducts";
      }

      const itemBalancePayment = outstandingAmounts[idx];
      const itemPaidAmount = adjustedPayments[idx];
      
      const rowSplitPayment = groupTotalPaymentValue / groupRows.length;
      const itemSplitPaidAmount = rowSplitPayment;

      const potentialLoss = Math.max(0, row.poValue - row.deliveryValue);
      const unitPrice = row.poQty > 0 ? (row.poValue / row.poQty) : 0;

      parsedRows.push({
        id: `row-${row.r}-main`,
        date: row.date,
        good: goodName,
        orderedVolume: row.poQty,
        deliveredVolume: row.deliveryQty,
        unitPrice,
        paidAmount: itemPaidAmount,
        splitPaidAmount: itemSplitPaidAmount,
        orderedValue: row.poValue,
        deliveredValue: row.deliveryValue,
        potentialLoss,
        balancePayment: itemBalancePayment,
        rawRow: [row.date, goodName, row.comment]
      });
    }
  });

  return parsedRows;
}

// API endpoint to fetch and parse spreadsheet
app.get("/api/sheets-data", async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const defaultSheetId = "17Rx4bLUGgSzHT3HLbDAd_2pdueB8W-476x2_48IzwWg";
  const sheetId = (req.query.id as string) || defaultSheetId;
  
  if (!forceRefresh && !isCacheStale(sheetId)) {
    const cached = cacheMap.get(sheetId);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        lastUpdated: cached.lastUpdated,
        cached: true,
      });
    }
  }

  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    console.log(`[sheets-data] Fetching spreadsheet CSV: ${csvUrl}`);
    
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch spreadsheet. Status: ${response.status}`);
    }

    const csvText = await response.text();
    const rawRows = parseCSV(csvText);
    
    // Dump first rows logging to terminal for troubleshooting
    console.log(`Successfully fetched Google Sheet. Total rows detected: ${rawRows.length}`);
    if (rawRows.length > 0) {
      console.log(`Detected columns/first row: ${JSON.stringify(rawRows[0])}`);
    }
    if (rawRows.length > 1) {
      console.log(`Detected second row: ${JSON.stringify(rawRows[1])}`);
    }

    const processedData = processSheetData(rawRows);
    
    cacheMap.set(sheetId, {
      data: processedData,
      rawCsv: csvText,
      lastUpdated: new Date().toISOString(),
    });

    const cachedEntry = cacheMap.get(sheetId)!;

    return res.json({
      success: true,
      data: processedData,
      lastUpdated: cachedEntry.lastUpdated,
      cached: false,
    });
  } catch (err: any) {
    console.error("Error fetching/processing sheet data:", err.message);
    
    // Fallback to cache if available
    const cached = cacheMap.get(sheetId);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        lastUpdated: cached.lastUpdated,
        cached: true,
        warning: `Failed to fetch fresh data: ${err.message}. Serving cached version.`,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Could not fetch or parse spreadsheet data. Please check connection and confirm that the spreadsheet is public.",
      details: err.message,
    });
  }
});

// Serve health status
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Veggies/Fruits Operations Server running on port ${PORT}`);
  });
}

startServer();
