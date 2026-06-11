import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { OperationsRow } from "../types";

// Format date nicely
function formatDateString(dateStr: string): string {
  if (!dateStr) return "N/A";
  return dateStr;
}

// Generate the Financials PDF report (containing ordered, delivered, paid, and balance financials)
// Helper to robustly parse various date formats from Google Sheets
function parseDateString(dateStr: string): Date {
  if (!dateStr) return new Date();
  
  const cleanStr = dateStr.trim();
  const parts = cleanStr.split(/[-./\s]+/);
  if (parts.length >= 3) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthPart = parts[1].toLowerCase().slice(0, 3);
    const mIdx = months.indexOf(monthPart);
    
    if (mIdx !== -1) {
      const day = parseInt(parts[0], 10);
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(year, mIdx, day);
    }
    
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (parts[0].length === 4) {
        return new Date(p0, p1 - 1, p2);
      } else {
        let year = p2;
        if (parts[2].length === 2) year += 2000;
        return new Date(year, p1 - 1, p0);
      }
    }
  }

  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return new Date();
}

// Generate the Financials PDF report (containing ordered, delivered, paid, and balance financials)
export function downloadFinancialsReport(data: OperationsRow[], dateRangeLabel: string) {
  const doc = new jsPDF();

  // Header & Branding (Sage Green theme accent - #5d6d4e)
  doc.setFillColor(93, 109, 78); // #5d6d4e
  doc.rect(0, 0, 210, 38, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("NIRAIPULAM AGROPRODUCTS", 14, 20);
  
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Financial Ledger Report (Date, PO, Delivered, Price, Paid, Outstanding)", 14, 28);

  // Metadata Panel
  doc.setTextColor(51, 65, 85); // Slate-700
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 48);
  doc.text(`Selected Period: ${dateRangeLabel}`, 14, 53);
  doc.text("Source: Google Sheets Live Operations Sync", 14, 58);

  // Group data by Date to compute Daily Totals and Averages
  const dateGroups: Record<string, {
    date: string;
    poValue: number;
    deliveredValue: number;
    unitPriceSum: number;
    unitPriceCount: number;
    paidAmount: number;
    outstanding: number;
  }> = {};

  data.forEach(row => {
    const d = row.date;
    if (!dateGroups[d]) {
      dateGroups[d] = {
        date: d,
        poValue: 0,
        deliveredValue: 0,
        unitPriceSum: 0,
        unitPriceCount: 0,
        paidAmount: 0,
        outstanding: 0,
      };
    }
    const g = dateGroups[d];
    g.poValue += row.orderedValue;
    g.deliveredValue += row.deliveredValue;
    if (row.unitPrice > 0) {
      g.unitPriceSum += row.unitPrice;
      g.unitPriceCount += 1;
    }
    g.paidAmount += row.paidAmount;
    g.outstanding += row.balancePayment;
  });

  // Sort groups chronologically
  const sortedGroups = Object.values(dateGroups).sort((a, b) => {
    return parseDateString(a.date).getTime() - parseDateString(b.date).getTime();
  });

  // Calculate total paidAmount using the dashboard card's split-paid-amount logic
  const totPaid = data.reduce((acc, curr) => acc + (curr.splitPaidAmount !== undefined ? curr.splitPaidAmount : curr.paidAmount), 0);

  // Financial summary calculations across sorted date groups
  let totOrdered = 0;
  let totDelivered = 0;
  let totBalance = 0;
  let totalUnitPriceSum = 0;
  let totalUnitPriceCount = 0;

  sortedGroups.forEach(g => {
    totOrdered += g.poValue;
    totDelivered += g.deliveredValue;
    totBalance += g.outstanding;
    if (g.unitPriceCount > 0) {
      totalUnitPriceSum += (g.unitPriceSum / g.unitPriceCount);
      totalUnitPriceCount += 1;
    }
  });

  const overallAvgUnitPrice = totalUnitPriceCount > 0 ? totalUnitPriceSum / totalUnitPriceCount : 0;

  // Summary widgets
  doc.setDrawColor(226, 232, 240);
  doc.rect(14, 63, 182, 18, "D");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL PO VALUE", 18, 70);
  doc.text("TOTAL DELIVERED VAL", 64, 70);
  doc.text("TOTAL AMOUNT PAID", 120, 70);
  doc.text("TOTAL OUTSTANDING", 158, 70);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Rs. ${totOrdered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 18, 76);
  doc.text(`Rs. ${totDelivered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 64, 76);
  doc.text(`Rs. ${totPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 120, 76);
  doc.text(`Rs. ${totBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 158, 76);

  // Generate Table data
  const tableHeaders = [["Date", "Total PO Value", "Total Delivered Value", "Average Unit Price", "Amount Paid", "Outstanding"]];
  const tableRows = sortedGroups.map(g => {
    const avgPrice = g.unitPriceCount > 0 ? g.unitPriceSum / g.unitPriceCount : 0;
    return [
      formatDateString(g.date),
      `Rs. ${g.poValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Rs. ${g.deliveredValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Rs. ${avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Rs. ${g.paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Rs. ${g.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ];
  });

  // Append total row
  tableRows.push([
    "TOTALS",
    `Rs. ${totOrdered.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    `Rs. ${totDelivered.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    `Rs. ${overallAvgUnitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    `Rs. ${totPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    `Rs. ${totBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
  ]);

  autoTable(doc, {
    startY: 87,
    head: tableHeaders,
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [93, 109, 78], // Sage green
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [62, 58, 54], // earth-800
    },
    alternateRowStyles: {
      fillColor: [253, 251, 247], // Soft brand background
    },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 32, halign: "right" },
      2: { cellWidth: 35, halign: "right" },
      3: { cellWidth: 32, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 30, halign: "right" }
    },
    didParseCell: (dataCell: any) => {
      // Bold the last row (Totals row)
      if (dataCell.row.index === tableRows.length - 1) {
        dataCell.cell.styles.fontStyle = "bold";
        dataCell.cell.styles.fillColor = [227, 245, 235];
      }
    }
  });

  // Footer page number
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pageCount}`, 196, 287, { align: "right" });
    doc.text("Niraipulam Agroproducts - Confidential Operations Ledger", 14, 287);
  }

  doc.save(`niraipulam_financial_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Generate an underlying data report associated with a specific chart
export function downloadChartDataReport(
  chartTitle: string,
  headers: string[],
  keys: string[],
  data: OperationsRow[],
  dateRangeLabel: string
) {
  const doc = new jsPDF();

  // Header & Branding (Sage Green theme accent - #5d6d4e)
  doc.setFillColor(93, 109, 78); // #5d6d4e
  doc.rect(0, 0, 210, 38, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(chartTitle.toUpperCase(), 14, 20);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Underlying Chart Source Data Ledger & Audit Log", 14, 28);

  // Metadata Panel
  doc.setTextColor(51, 65, 85); // Slate-700
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 48);
  doc.text(`Filter Window: ${dateRangeLabel}`, 14, 53);
  doc.text(`Data Source: Verified Operations Spreadsheet`, 14, 58);

  // Table rows mapping dynamically based on given keys
  const tableRows = data.map(item => {
    return keys.map(key => {
      const val = (item as any)[key];
      if (typeof val === "number") {
        if (key.toLowerCase().includes("volume") || key.toLowerCase().includes("qty") || key.toLowerCase().includes("delivered") || key.toLowerCase().includes("ordered")) {
          return val % 1 === 0 ? val.toString() : val.toFixed(1);
        }
        if (key.toLowerCase().includes("price") || key.toLowerCase().includes("value") || key.toLowerCase().includes("loss") || key.toLowerCase().includes("payment") || key.toLowerCase().includes("paid") || key.toLowerCase().includes("amount") || key.toLowerCase().includes("due")) {
          return `Rs. ${val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
        }
        return val.toLocaleString();
      }
      return formatDateString(val) || "-";
    });
  });

  // Calculate Column aggregates for totals row
  const totalsRow: string[] = [];
  keys.forEach((key, idx) => {
    if (idx === 0) {
      totalsRow.push("TOTALS");
    } else if (idx === 1 && keys[0] !== "good") {
      totalsRow.push("-");
    } else {
      // Sum value if numeric representable
      const isNumeric = data.some(item => typeof (item as any)[key] === "number");
      if (isNumeric) {
        let sum = data.reduce((acc, curr) => acc + ((curr as any)[key] || 0), 0);
        if (key.toLowerCase().includes("price")) {
          // Average unit price instead of sum
          const avg = data.length > 0 ? sum / data.length : 0;
          totalsRow.push(`Rs. ${avg.toFixed(2)} (Avg)`);
        } else if (key.toLowerCase().includes("volume") || key.toLowerCase().includes("qty") || key.toLowerCase().includes("delivered") || key.toLowerCase().includes("ordered")) {
          totalsRow.push(sum % 1 === 0 ? sum.toString() : sum.toFixed(1));
        } else {
          totalsRow.push(`Rs. ${sum.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`);
        }
      } else {
        totalsRow.push("-");
      }
    }
  });
  tableRows.push(totalsRow);

  autoTable(doc, {
    startY: 68,
    head: [headers],
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [93, 109, 78], // Sage green
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [62, 58, 54], // earth-800
    },
    alternateRowStyles: {
      fillColor: [253, 251, 247],
    },
    didParseCell: (dataCell: any) => {
      // Bold the last row (Totals row)
      if (dataCell.row.index === tableRows.length - 1) {
        dataCell.cell.styles.fontStyle = "bold";
        dataCell.cell.styles.fillColor = [227, 245, 235];
      }
    }
  });

  // Footer page number
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pageCount}`, 196, 287, { align: "right" });
    doc.text(`Niraipulam Agroproducts - Chart Audit Log: ${chartTitle}`, 14, 287);
  }

  const cleanTitle = chartTitle.toLowerCase().replace(/[^a-z0-9]/g, "_");
  doc.save(`niraipulam_${cleanTitle}_data_${new Date().toISOString().slice(0, 10)}.pdf`);
}
