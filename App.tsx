import { useState, useEffect, useMemo, ReactNode } from "react";
import { 
  TrendingUp, 
  ArrowDownLeft, 
  Coins, 
  Percent, 
  FileText, 
  RefreshCw, 
  AlertCircle, 
  Calendar, 
  Search, 
  Database,
  ChevronDown,
  Info,
  CalendarDays,
  FileSpreadsheet,
  Layers,
  ArrowUpRight,
  TrendingDown,
  ShoppingCart
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  Cell
} from "recharts";
import { OperationsRow, SummaryStats, GoodsTracker } from "./types";
import { downloadFinancialsReport, downloadChartDataReport } from "./utils/pdfGenerator";

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
      // DD-MMM-YY or DD-MMM-YYYY
      const day = parseInt(parts[0], 10);
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(year, mIdx, day);
    }
    
    // Check if numbers
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        return new Date(p0, p1 - 1, p2);
      } else {
        // DD-MM-YYYY or DD-MM-YY (e.g., 20/04/2026 or 11/06/2026)
        let year = p2;
        if (parts[2].length === 2) year += 2000;
        return new Date(year, p1 - 1, p0);
      }
    }
  }

  // Fallback to standard direct parsing if manual format did not match
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return new Date();
}

// Extract Spreadsheet ID from Google Sheets URL
function extractSpreadsheetId(url: string): string {
  if (!url) return "17Rx4bLUGgSzHT3HLbDAd_2pdueB8W-476x2_48IzwWg";
  if (url.includes("/d/")) {
    const part = url.split("/d/")[1];
    if (part) {
      return part.split("/")[0] || "17Rx4bLUGgSzHT3HLbDAd_2pdueB8W-476x2_48IzwWg";
    }
  }
  return url.trim();
}

// Formatting currency helper
function currencyFormatter(val: number): string {
  return `Rs. ${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function App() {
  const defaultSheetUrl = "https://docs.google.com/spreadsheets/d/17Rx4bLUGgSzHT3HLbDAd_2pdueB8W-476x2_48IzwWg/edit?gid=0#gid=0";
  
  // State
  const [sheetUrl, setSheetUrl] = useState(defaultSheetUrl);
  const [data, setData] = useState<OperationsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cachedStatus, setCachedStatus] = useState(false);
  const [isUrlEditing, setIsUrlEditing] = useState(false);
  
  // Filter States
  const [timePeriod, setTimePeriod] = useState<"all" | "7d" | "30d" | "custom">("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Fetch operations data from API
  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const sheetId = extractSpreadsheetId(sheetUrl);
      const url = `/api/sheets-data?id=${sheetId}${forceRefresh ? "&refresh=true" : ""}`;
      
      const res = await fetch(url);
      const resJson = await res.json();
      
      if (resJson.success) {
        setData(resJson.data);
        setLastUpdated(resJson.lastUpdated);
        setCachedStatus(resJson.cached);
      } else {
        throw new Error(resJson.error || "Failed to load sheet data");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred while fetching your veggies/fruits operations.");
    } finally {
      setLoading(false);
    }
  };

  // Initial Fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Sync back to default sheet if user requests
  const resetToDefault = () => {
    setSheetUrl(defaultSheetUrl);
    setTimeout(() => {
      fetchData(true);
    }, 50);
  };

  // Chronologically sorted operations data
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const dateA = parseDateString(a.date).getTime();
      const dateB = parseDateString(b.date).getTime();
      return dateA - dateB;
    });
  }, [data]);

  // Unique goods/items list for filtering
  const uniqueGoods = useMemo(() => {
    const products = new Set<string>();
    data.forEach(row => {
      if (row.good && row.good.trim() !== "" && row.good !== "General Agroproducts") {
        products.add(row.good);
      }
    });
    return Array.from(products).sort();
  }, [data]);

  // Filter operations by Selected Timeframe, Product, and Search Queries
  const filteredData = useMemo(() => {
    return sortedData.filter(row => {
      // 1. Product Filter
      if (selectedProduct !== "all" && row.good !== selectedProduct) {
        return false;
      }

      // 2. Search Query Filter
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const matchesGood = row.good ? row.good.toLowerCase().includes(query) : false;
        const matchesDate = row.date ? row.date.toLowerCase().includes(query) : false;
        if (!matchesGood && !matchesDate) return false;
      }

      // 3. Time Range Filter
      if (timePeriod === "all") return true;

      const rowDate = parseDateString(row.date);
      const now = new Date();

      if (timePeriod === "7d") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);
        return rowDate >= sevenDaysAgo;
      }

      if (timePeriod === "30d") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        return rowDate >= thirtyDaysAgo;
      }

      if (timePeriod === "custom") {
        if (customStartDate) {
          const start = new Date(customStartDate);
          start.setHours(0, 0, 0, 0);
          if (rowDate < start) return false;
        }
        if (customEndDate) {
          const end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
          if (rowDate > end) return false;
        }
      }

      return true;
    });
  }, [sortedData, timePeriod, customStartDate, customEndDate, selectedProduct, searchQuery]);

  // Dynamic Date Range label for reports and cards
  const dateRangeLabel = useMemo(() => {
    if (filteredData.length === 0) return "No Data Available";
    const start = filteredData[0].date || "N/A";
    const end = filteredData[filteredData.length -1].date || "N/A";
    if (timePeriod === "all") return `All Time (${start} to ${end})`;
    if (timePeriod === "7d") return `Last 7 Days (${start} to ${end})`;
    if (timePeriod === "30d") return `Last 30 Days (${start} to ${end})`;
    return `Custom Range (${start} to ${end})`;
  }, [filteredData, timePeriod]);

  // Operational & Financial summary computations
  const stats = useMemo((): SummaryStats => {
    let totalRevenue = 0; // delivered value
    let totalLoss = 0; // potential loss due to unfulfilled volumes
    let totalOrdersValue = 0; // expected revenue
    let totalPaid = 0;
    let totalBalanceDue = 0;
    let totalOrderedVolume = 0;
    let totalDeliveredVolume = 0;

    filteredData.forEach(row => {
      totalRevenue += row.deliveredValue;
      totalLoss += row.potentialLoss;
      totalOrdersValue += row.orderedValue;
      totalPaid += row.splitPaidAmount !== undefined ? row.splitPaidAmount : row.paidAmount;
      totalBalanceDue += row.balancePayment;
      totalOrderedVolume += row.orderedVolume;
      totalDeliveredVolume += row.deliveredVolume;
    });

    const fulfillmentRate = totalOrderedVolume > 0 
      ? (totalDeliveredVolume / totalOrderedVolume) * 100 
      : 100;

    return {
      totalRevenue,
      totalLoss,
      totalOrdersValue,
      totalPaid,
      totalBalanceDue,
      totalOrderedVolume,
      totalDeliveredVolume,
      fulfillmentRate,
    };
  }, [filteredData]);

  // Aggregate stats by Good types (ice apple, pomegranate, etc.)
  const goodsAggregated = useMemo((): GoodsTracker[] => {
    const agg: Record<string, { ordered: number; delivered: number; dValue: number; loss: number; paid: number; due: number }> = {};
    
    filteredData.forEach(row => {
      // Commodities are only those mentioned in column N (exclude blank/general rows)
      if (row.good === "General Agroproducts") return;
      const key = row.good || "Other";
      if (!agg[key]) {
        agg[key] = { ordered: 0, delivered: 0, dValue: 0, loss: 0, paid: 0, due: 0 };
      }
      agg[key].ordered += row.orderedVolume;
      agg[key].delivered += row.deliveredVolume;
      agg[key].dValue += row.deliveredValue;
      agg[key].loss += row.potentialLoss;
      agg[key].paid += row.splitPaidAmount !== undefined ? row.splitPaidAmount : row.paidAmount;
      agg[key].due += row.balancePayment;
    });

    return Object.entries(agg).map(([goodName, stats]) => ({
      goodName,
      totalOrderedVolume: parseFloat(stats.ordered.toFixed(1)),
      totalDeliveredVolume: parseFloat(stats.delivered.toFixed(1)),
      revenue: parseFloat(stats.dValue.toFixed(2)),
      loss: parseFloat(stats.loss.toFixed(2)),
      paid: parseFloat(stats.paid.toFixed(2)),
      due: parseFloat(stats.due.toFixed(2)),
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredData]);

  // Days Operated stats starting from operations launch date: 20th of April 2026
  const daysStats = useMemo(() => {
    const launchDate = new Date(2026, 3, 20); // April 20, 2026
    launchDate.setHours(0, 0, 0, 0);

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let totalDays = 0;

    if (timePeriod === "7d") {
      totalDays = 7;
    } else if (timePeriod === "30d") {
      totalDays = 30;
    } else if (timePeriod === "custom") {
      if (customStartDate) {
        const startObj = new Date(customStartDate);
        startObj.setHours(0, 0, 0, 0);
        const endObj = customEndDate ? new Date(customEndDate) : new Date();
        endObj.setHours(0, 0, 0, 0);
        totalDays = Math.max(1, Math.round((endObj.getTime() - startObj.getTime()) / (24 * 60 * 60 * 1000)) + 1);
      } else {
        const dateObjects = filteredData.map(row => parseDateString(row.date));
        const minRowTime = dateObjects.length > 0 ? Math.min(...dateObjects.map(d => d.getTime())) : launchDate.getTime();
        const maxRowTime = dateObjects.length > 0 ? Math.max(...dateObjects.map(d => d.getTime())) : now.getTime();
        const startObj = new Date(minRowTime);
        startObj.setHours(0, 0, 0, 0);
        const endObj = new Date(maxRowTime);
        endObj.setHours(0, 0, 0, 0);
        totalDays = Math.max(1, Math.round((endObj.getTime() - startObj.getTime()) / (24 * 60 * 60 * 1000)) + 1);
      }
    } else {
      // "all" or other
      const dateObjects = sortedData.map(row => parseDateString(row.date));
      const maxRowTime = dateObjects.length > 0 ? Math.max(...dateObjects.map(d => d.getTime())) : now.getTime();
      const endObj = new Date(Math.max(now.getTime(), maxRowTime));
      endObj.setHours(0, 0, 0, 0);
      totalDays = Math.max(1, Math.round((endObj.getTime() - launchDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    }

    // Count of unique dates with entries in filteredData
    const uniqueDatesSet = new Set<string>();
    filteredData.forEach(row => {
      if (row.date) {
        uniqueDatesSet.add(row.date.trim());
      }
    });

    const operatedDays = uniqueDatesSet.size;
    const percentage = totalDays > 0 ? (operatedDays / totalDays) * 100 : 0;

    return {
      operatedDays,
      totalDays,
      percentage
    };
  }, [filteredData, sortedData, timePeriod, customStartDate, customEndDate]);

  // Today's stats: absolute latest date in the dataset
  const todayStats = useMemo(() => {
    if (sortedData.length === 0) {
      return { date: "N/A", ordered: 0, delivered: 0 };
    }
    const latestDateStr = sortedData[sortedData.length - 1].date;
    let ordered = 0;
    let delivered = 0;
    sortedData.forEach(row => {
      if (row.date === latestDateStr) {
        ordered += row.orderedValue;
        delivered += row.deliveredValue;
      }
    });
    return {
      date: latestDateStr,
      ordered,
      delivered
    };
  }, [sortedData]);

  // 7-day activity anomaly & alert scanner
  const scanAlerts = useMemo(() => {
    if (sortedData.length === 0) return [];
    
    const latestDateObj = parseDateString(sortedData[sortedData.length - 1].date);
    const msInDay = 24 * 60 * 60 * 1000;
    const sevenDaysLimit = latestDateObj.getTime() - (7 * msInDay);
    
    const alerts: string[] = [];
    
    sortedData.forEach(row => {
      const rowDateObj = parseDateString(row.date);
      if (rowDateObj.getTime() >= sevenDaysLimit) {
        if (row.potentialLoss > 3000) {
          alerts.push(`${row.date}: ${row.good} dispatch shortfall (Loss: ${currencyFormatter(row.potentialLoss)})`);
        }
        if (row.balancePayment > 5000) {
          alerts.push(`${row.date}: ${row.good} outstanding balance of ${currencyFormatter(row.balancePayment)}`);
        }
        if (row.rawRow && Array.isArray(row.rawRow) && row.rawRow[2]) {
          const comment = row.rawRow[2].toLowerCase();
          if (comment.includes("not delivered") || comment.includes("cancelled") || comment.includes("shortage")) {
            alerts.push(`${row.date} Alert: "${row.rawRow[2]}"`);
          }
        }
      }
    });
    
    return Array.from(new Set(alerts)).slice(0, 5);
  }, [sortedData]);

  // WhatsApp share report body
  const whatsAppText = useMemo(() => {
    const todayStr = todayStats.date !== "N/A" ? todayStats.date : new Date().toLocaleDateString();
    const currentDateStr = new Date().toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' });
    
    let text = `*NIRAIPULAM AGROPRODUCTS OPERATIONS REPORT*\n`;
    text += `📅 Date: ${currentDateStr}\n\n`;
    
    text += `*CUMULATIVE METRICS:*\n`;
    text += `• Total Delivered Revenue vs Ordered: ${currencyFormatter(stats.totalRevenue)} vs ${currencyFormatter(stats.totalOrdersValue)}\n`;
    text += `• Total Amount Paid: ${currencyFormatter(stats.totalPaid)}\n`;
    text += `• Outstanding Payment Due: ${currencyFormatter(stats.totalBalanceDue)}\n\n`;
    
    text += `*TODAY'S OPERATIONS (${todayStr}):*\n`;
    text += `• Today's Ordered Value: ${currencyFormatter(todayStats.ordered)}\n`;
    text += `• Today's Delivered Value: ${currencyFormatter(todayStats.delivered)}\n\n`;
    
    text += `*7-DAY ACTIVITY LEAK ALERTS & OUTLIERS:*\n`;
    if (scanAlerts.length > 0) {
      scanAlerts.forEach(alert => {
        text += `• ⚠️ ${alert}\n`;
      });
    } else {
      text += `• No critical red flags or payment outliers detected in this cycle.\n`;
    }
    
    text += `\n_Generated dynamically from Niraipulam Cloud Ledger_`;
    return text;
  }, [stats, todayStats, scanAlerts, dateRangeLabel]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(whatsAppText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // PDF Export Trigger callbacks
  const handlePdfFinancialsReport = () => {
    downloadFinancialsReport(filteredData, dateRangeLabel);
  };

  const handlePdfChartDailySales = () => {
    downloadChartDataReport(
      "Daily Sales and Revenue Volumes",
      ["Date", "Good Type", "Ordered Vol", "Delivered Vol", "Unit Price", "Value Ordered", "Revenue (Delivered)"],
      ["date", "good", "orderedVolume", "deliveredVolume", "unitPrice", "orderedValue", "deliveredValue"],
      filteredData,
      dateRangeLabel
    );
  };

  const handlePdfChartLoss = () => {
    downloadChartDataReport(
      "Financial Revenue Loss Tracker",
      ["Date", "Good Type", "Ordered", "Delivered", "Unfulfilled", "Unit Price", "Potential Loss (Financial)"],
      ["date", "good", "orderedVolume", "deliveredVolume", "unfulfilledVolume", "unitPrice", "potentialLoss"],
      filteredData.map(item => ({
        ...item,
        unfulfilledVolume: Math.max(0, item.orderedVolume - item.deliveredVolume)
      })),
      dateRangeLabel
    );
  };

  const handlePdfChartBalanceTracker = () => {
    downloadChartDataReport(
      "Customer Balance Payment Tracker",
      ["Date", "Good Type", "Delivered Revenue", "Amount Paid", "Balance Owed (Outstanding)"],
      ["date", "good", "deliveredValue", "paidAmount", "balancePayment"],
      filteredData,
      dateRangeLabel
    );
  };

  const handlePdfChartGoods = () => {
    const rawGoodsData = goodsAggregated.map(gd => {
      return {
        date: "ALL SELECTED",
        good: gd.goodName,
        orderedVolume: gd.totalOrderedVolume,
        deliveredVolume: gd.totalDeliveredVolume,
        unitPrice: gd.totalDeliveredVolume > 0 ? (gd.revenue / gd.totalDeliveredVolume) : 0,
        orderedValue: gd.revenue + gd.loss,
        deliveredValue: gd.revenue,
        potentialLoss: gd.loss,
        balancePayment: gd.due,
        paidAmount: gd.paid
      } as OperationsRow;
    });

    downloadChartDataReport(
      "Commodities Sales and Volume Summary",
      ["Good (Fresh Product)", "Total Ordered Vol", "Total Delivered Vol", "Aggregated Revenue", "Aggregate Loss", "Balance Outstanding"],
      ["goodName", "totalOrderedVolume", "totalDeliveredVolume", "revenue", "loss", "due"],
      rawGoodsData as any,
      dateRangeLabel
    );
  };



  // Average time since last update string
  const updateBadgeText = useMemo(() => {
    if (!lastUpdated) return "Uncached";
    const parsed = new Date(lastUpdated);
    return `Updated ${parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${parsed.toLocaleDateString()})`;
  }, [lastUpdated]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-700">
      {/* HEADER SECTION */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs" id="dashboard-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Logo and Brand Title */}
            <div className="flex items-center space-x-4">
              <img
                src="/src/assets/images/niraipulam_logo_1781175911863.png"
                alt="Niraipulam Agroproducts Logo"
                className="h-16 w-16 rounded-xl object-cover bg-white p-1 border border-slate-200 shadow-xs"
                referrerPolicy="no-referrer"
                id="brand-logo"
              />
              <div>
                <div className="flex flex-col">
                  <span className="text-slate-500 font-bold tracking-widest text-[10px] uppercase mb-0.5">Corporate Operations Dashboard</span>
                  <h1 className="text-xl sm:text-2xl font-sans text-slate-950 font-bold tracking-tight">Niraipulam Agroproducts</h1>
                </div>
                <p className="text-xs text-slate-500 font-medium font-sans">Blinkit Dispatch Log & Strategic Financial Intel</p>
              </div>
            </div>

            {/* Global Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Last Updated Badge & Manual Sync */}
              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-1" id="refresh-component">
                <span className="text-[10px] font-mono font-medium text-slate-700 px-3 py-1 flex items-center gap-1.5" title="Data is cached for up to 12 hours server-side to comply with updates timeline">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  {updateBadgeText}
                </span>
                <button
                  onClick={() => fetchData(true)}
                  disabled={loading}
                  className="p-1 px-2.5 bg-white border border-slate-200 rounded-md text-3xs font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-all flex items-center gap-1 shadow-xs disabled:opacity-50 cursor-pointer"
                  title="Force re-fetch from Google Sheets"
                  id="btn-force-refresh"
                >
                  <RefreshCw className={`h-3 w-3 text-slate-500 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {/* Financial Report Download */}
              <button
                onClick={handlePdfFinancialsReport}
                disabled={loading || data.length === 0}
                className="inline-flex items-center justify-center px-4 py-2 bg-slate-800 hover:bg-slate-900 active:bg-slate-950 text-white text-xs font-semibold rounded-lg transition-all shadow-xs disabled:opacity-50 gap-1.5 cursor-pointer"
                id="btn-financial-pdf"
              >
                <FileText className="h-4 w-4" />
                Download Financial Report (PDF)
              </button>
            </div>
          </div>


        </div>
      </header>

      {/* ERROR FEEDBACK BAR */}
      {error && (
        <div className="bg-rose-50 border-b border-rose-200 py-3.5 px-4" id="error-banner">
          <div className="max-w-7xl mx-auto flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 text-rose-600 flex-none mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-rose-800">Operational Sync Error</h3>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
              <div className="mt-2.5 flex items-center gap-3">
                <button
                  onClick={() => fetchData(true)}
                  className="bg-white border border-rose-300 text-rose-800 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs hover:bg-rose-100 transition-all"
                  id="btn-error-retry"
                >
                  Retry Fetching Ledger
                </button>
                <div className="text-xs text-rose-600">
                  Provide a public link to your Google Sheet or check access permissions.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FILTER CONTROL BOARD */}
      <section className="bg-white border-b border-slate-200 py-4 shadow-3xs" id="filter-board">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            
            {/* Left side: Time selectors */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                <Calendar className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-700">Period:</span>
              </div>
              
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-3xs" id="time-period-group">
                <button
                  onClick={() => setTimePeriod("all")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timePeriod === "all" ? "bg-white text-slate-900 font-bold shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-900"}`}
                >
                  All Ledger
                </button>
                <button
                  onClick={() => setTimePeriod("7d")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timePeriod === "7d" ? "bg-white text-slate-900 font-bold shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-900"}`}
                >
                  Last 7d
                </button>
                <button
                  onClick={() => setTimePeriod("30d")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timePeriod === "30d" ? "bg-white text-slate-900 font-bold shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-900"}`}
                >
                  Last 30d
                </button>
                <button
                  onClick={() => setTimePeriod("custom")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timePeriod === "custom" ? "bg-white text-slate-900 font-bold shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-900"}`}
                >
                  Custom Range
                </button>
              </div>

              {/* Custom Date Picker inputs */}
              {timePeriod === "custom" && (
                <div className="flex items-center space-x-2 animate-fadeIn bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-3xs" id="custom-date-selectors">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                  <span className="text-xs text-slate-450 font-semibold">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </div>
              )}
            </div>

            {/* Right side: Search and crop items filter */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Crop Product Selector */}
              <div className="flex items-center space-x-1" id="product-filter-container">
                <span className="text-xs font-semibold text-slate-500">Commodity:</span>
                <select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg py-1.5 px-3 text-xs font-semibold text-slate-700 outline-none transition-all shadow-3xs cursor-pointer focus:ring-1 focus:ring-slate-500"
                  id="product-select"
                >
                  <option value="all">All Goods</option>
                  {uniqueGoods.map(good => (
                    <option key={good} value={good}>{good}</option>
                  ))}
                </select>
              </div>

              {/* Search bar */}
              <div className="relative" id="product-search-container">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                </span>
                <input
                  type="text"
                  placeholder="Search ledger..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-500 rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-700 outline-none transition-all shadow-3xs min-w-[180px] focus:ring-1 focus:ring-slate-500"
                />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* CORE BODY SCREEN */}
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        {loading ? (
          /* Loading Skeleton Dashboard */
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-4" id="loading-state">
            <RefreshCw className="h-10 w-10 text-emerald-600 animate-spin" />
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">Reading Veggies & Fruits Operations Ledger</h3>
              <p className="text-xs text-slate-400 mt-1">Downloading live CSV table and compiling financial records...</p>
            </div>
          </div>
        ) : filteredData.length === 0 ? (
          /* Empty Data Warning */
          <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center shadow-3xs" id="empty-state">
            <AlertCircle className="h-12 w-12 text-slate-400 mx-auto" />
            <h3 className="text-lg font-bold text-slate-800 mt-3">No Records Found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              We couldn't locate any veggie or fruit operations for the selected period "{dateRangeLabel}" or product query "{selectedProduct}".
            </p>
            <div className="mt-5">
              <button
                onClick={() => {
                  setTimePeriod("all");
                  setSelectedProduct("all");
                  setSearchQuery("");
                }}
                className="px-4 py-2 bg-slate-800 text-white font-bold text-xs rounded-lg shadow-sm hover:bg-slate-900 transition"
              >
                Reset All Filters
              </button>
            </div>
          </div>
        ) : (
          /* ACTIVE DASHBOARD */
          <div className="space-y-6" id="dashboard-content">
            
            {/* STATS HIGHLIGHT WIDGETS */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 sm:gap-4" id="stats-widgets">
              
              {/* Card 1: Booked Order Value */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-slate-400 uppercase tracking-wider">Booked Order Value</p>
                    <p className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-1">
                      {currencyFormatter(stats.totalOrdersValue)}
                    </p>
                  </div>
                  <div className="p-1 px-2 bg-slate-50 text-slate-500 border border-slate-200 rounded-md text-[9px] font-bold flex items-center gap-0.5">
                    <ShoppingCart className="h-3 w-3 flex-none" />
                    Orders
                  </div>
                </div>
                <p className="text-4xs font-medium text-slate-500 mt-2">
                  Total booked PO value
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-400 rounded-b-xl" />
              </div>

              {/* Card 2: Revenue Delivered */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-slate-400 uppercase tracking-wider">Revenue Delivered</p>
                    <p className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-1">
                      {currencyFormatter(stats.totalRevenue)}
                    </p>
                  </div>
                  <div className="p-1 px-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-md text-[9px] font-bold flex items-center gap-0.5">
                    <ArrowUpRight className="h-3 w-3 flex-none" />
                    Delivered
                  </div>
                </div>
                <p className="text-4xs font-medium text-emerald-600 mt-2 flex items-center gap-0.5">
                  Fulfillment: {stats.fulfillmentRate.toFixed(1)}%
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 rounded-b-xl" />
              </div>

              {/* Card 3: Revenue Loss */}
              <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-rose-500 uppercase tracking-wider">Revenue Loss</p>
                    <p className="text-base sm:text-lg font-bold font-mono text-rose-600 mt-1">
                      {currencyFormatter(stats.totalLoss)}
                    </p>
                  </div>
                  {stats.totalLoss > 0 ? (
                    <div className="p-1 px-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-[9px] font-bold flex items-center gap-0.5">
                      <TrendingDown className="h-3 w-3 flex-none" />
                      -{((stats.totalLoss / (stats.totalRevenue + stats.totalLoss || 1)) * 105).toFixed(0)}%
                    </div>
                  ) : (
                    <div className="p-1 px-2 bg-white text-emerald-600 border border-slate-200 rounded-md text-[9px] font-bold">
                      Zero Loss
                    </div>
                  )}
                </div>
                <p className="text-4xs font-medium text-rose-500 mt-2">
                  Unfulfilled order leakage
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-rose-500 rounded-b-xl" />
              </div>

              {/* Card 4: Amount Paid */}
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-blue-600 uppercase tracking-wider">Amount Paid</p>
                    <p className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-1">
                      {currencyFormatter(stats.totalPaid)}
                    </p>
                  </div>
                  <div className="p-1 px-2 bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-[9px] font-bold flex items-center gap-0.5">
                    <Coins className="h-3 w-3 flex-none" />
                    Cleared
                  </div>
                </div>
                <p className="text-4xs font-medium text-blue-600 mt-2">
                  {stats.totalRevenue > 0 ? ((stats.totalPaid / stats.totalRevenue) * 100).toFixed(0) : 0}% of delivered cleared
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 rounded-b-xl" />
              </div>

              {/* Card 5: Outstanding */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-slate-400 uppercase tracking-wider">Outstanding</p>
                    <p className={`text-base sm:text-lg font-bold font-mono mt-1 ${stats.totalBalanceDue > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {currencyFormatter(stats.totalBalanceDue)}
                    </p>
                  </div>
                  {stats.totalBalanceDue > 0 ? (
                    <div className="p-1 px-2 bg-amber-50 text-amber-600 border border-amber-200 rounded-md text-[9px] font-bold">
                      Outstanding
                    </div>
                  ) : (
                    <div className="p-1 px-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-md text-[9px] font-bold">
                      Paid Up
                    </div>
                  )}
                </div>
                <p className="text-4xs font-medium text-slate-450 mt-2">
                  Outstanding balance to collect
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500 rounded-b-xl" />
              </div>

              {/* Card 6: Showcase days operated divided by total days span of database */}
              <div className="bg-violet-50/50 border border-violet-200 rounded-xl p-4 shadow-xs relative overflow-hidden group">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xs font-bold text-violet-600 uppercase tracking-wider">Days Operated</p>
                    <p className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-1">
                      {daysStats.operatedDays} / {daysStats.totalDays}
                    </p>
                  </div>
                  <div className="p-1 px-2 bg-violet-100 text-violet-700 border border-violet-200 rounded-md text-[9px] font-bold flex items-center gap-0.5">
                    <CalendarDays className="h-3.5 w-3.5 flex-none" />
                    Timeline
                  </div>
                </div>
                <p className="text-4xs font-medium text-violet-600 mt-2">
                  {daysStats.percentage.toFixed(0)}% activity coverage rate
                </p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-violet-500 rounded-b-xl" />
              </div>

            </div>

            {/* CHARTS CONTAINER GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="charts-grid">

              {/* CARD CHART 1: DAILY SALES & REVENUE UNIT VOLUMES */}
              <div className="bg-white border border-slate-200 rounded-xl p-4.5 shadow-xs" id="chart-daily-sales">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                      <TrendingUp className="h-4 w-4 text-slate-600" />
                      Daily Sales & Revenue Unit Volumes
                    </h3>
                    <p className="text-4xs font-semibold text-slate-400 mt-0.5">Delivered value (revenue) vs units shipped daily</p>
                  </div>
                  <button
                    onClick={handlePdfChartDailySales}
                    className="p-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-3xs font-bold flex items-center gap-1 border border-slate-200 transition-colors cursor-pointer"
                    title="Download underlying data in selected timeframe as PDF"
                    id="btn-download-chart1"
                  >
                    <FileText className="h-3 w-3 text-slate-400" />
                    Data PDF
                  </button>
                </div>

                {/* Recharts responsive wrapper */}
                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={filteredData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false} 
                      />
                      <YAxis 
                        yAxisId="left"
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `Rs. ${val.toLocaleString()}`}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        stroke="#10b981" 
                        fontSize={9} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val} Kg`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          fontSize: "11px", 
                          backgroundColor: "#ffffff", 
                          borderRadius: "8px", 
                          border: "1px solid #e2e8f0",
                          color: "#1e293b"
                        }} 
                        formatter={(value: any, name: any) => {
                          if (name === "Delivered Revenue") return [currencyFormatter(value), "Delivered Revenue"];
                          if (name === "Delivered Volume") return [`${value} Units/Kgs`, "Shipped Volume"];
                          if (name === "Ordered Expected") return [currencyFormatter(value), "Expected Value"];
                          return [value, name];
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={24} 
                        iconSize={10} 
                        wrapperStyle={{ fontSize: "10px", marginTop: "10px" }} 
                      />
                      <Bar yAxisId="left" dataKey="deliveredValue" name="Delivered Revenue" fill="#10b981" radius={[4, 4, 0, 0]} barSize={18} />
                      <Bar yAxisId="left" dataKey="orderedValue" name="Ordered Expected" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={18} fillOpacity={0.4} />
                      <Line yAxisId="right" type="monotone" dataKey="deliveredVolume" name="Delivered Volume" stroke="#1e293b" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* CARD CHART 2: POTENTIAL REVENUE LOSS TRACKER */}
              <div className="bg-white border border-slate-200 rounded-xl p-4.5 shadow-xs" id="chart-loss-tracker">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                      <TrendingDown className="h-4 w-4 text-rose-500" />
                      Potential Revenue Loss (Financial Loss)
                    </h3>
                    <p className="text-4xs font-semibold text-slate-400 mt-0.5">Unfulfilled order volumes mapped in monetary value</p>
                  </div>
                  <button
                    onClick={handlePdfChartLoss}
                    className="p-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-3xs font-bold flex items-center gap-1 border border-slate-200 transition-colors cursor-pointer"
                    title="Download underlying loss data as PDF"
                    id="btn-download-chart2"
                  >
                    <FileText className="h-3 w-3 text-slate-400" />
                    Data PDF
                  </button>
                </div>

                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={filteredData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `Rs. ${val}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          fontSize: "11px", 
                          backgroundColor: "#ffffff", 
                          borderRadius: "8px", 
                          border: "1px solid #e2e8f0",
                          color: "#1e293b"
                        }} 
                        formatter={(value: any, name: any) => {
                          if (name === "Fulfillment Revenue Loss") return [currencyFormatter(value), "Potential Loss"];
                          return [value, name];
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={24} 
                        iconSize={10} 
                        wrapperStyle={{ fontSize: "10px", marginTop: "10px" }} 
                      />
                      <Bar dataKey="potentialLoss" name="Fulfillment Revenue Loss" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={18}>
                        {filteredData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.potentialLoss > 5000 ? "#e11d48" : entry.potentialLoss > 0 ? "#fda4af" : "#f1f5f9"} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* CARD CHART 3: BALANCE PAYMENT TRACKER */}
              <div className="bg-white border border-slate-200 rounded-xl p-4.5 shadow-xs" id="chart-balance-payment">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                      <Coins className="h-4 w-4 text-blue-500" />
                      Balance Payment Tracker (Expected vs Received)
                    </h3>
                    <p className="text-4xs font-semibold text-slate-400 mt-0.5">Tracking delivered revenue against cash received and outstanding balances</p>
                  </div>
                  <button
                    onClick={handlePdfChartBalanceTracker}
                    className="p-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-3xs font-bold flex items-center gap-1 border border-slate-200 transition-colors cursor-pointer"
                    title="Download underlying payment balance ledger as PDF"
                    id="btn-download-chart3"
                  >
                    <FileText className="h-3 w-3 text-slate-400" />
                    Data PDF
                  </button>
                </div>

                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={filteredData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorPaid" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                        </linearGradient>
                        <linearGradient id="colorOwed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `Rs. ${val}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          fontSize: "11px", 
                          backgroundColor: "#ffffff", 
                          borderRadius: "8px", 
                          border: "1px solid #e2e8f0",
                          color: "#1e293b"
                        }}
                        formatter={(value: any, name: any) => {
                          if (name === "actualRevenue") return [currencyFormatter(value), "Billed Revenue"];
                          if (name === "paid") return [currencyFormatter(value), "Amount Paid"];
                          if (name === "due") return [currencyFormatter(value), "Balance Outstanding"];
                          return [value, name];
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={24} 
                        iconSize={10} 
                        wrapperStyle={{ fontSize: "10px", marginTop: "10px" }} 
                      />
                      <Area type="monotone" dataKey="deliveredValue" name="actualRevenue" stroke="#10b981" fillOpacity={0} strokeWidth={2} />
                      <Area type="monotone" dataKey="paidAmount" name="paid" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPaid)" strokeWidth={2} />
                      <Area type="monotone" dataKey="balancePayment" name="due" stroke="#f59e0b" fillOpacity={1} fill="url(#colorOwed)" strokeDasharray="4 4" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* CARD CHART 4: GOODS SOLD PERFORMANCE TRACKER */}
              <div className="bg-white border border-slate-200 rounded-xl p-4.5 shadow-xs" id="chart-goods-sold">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                      <Layers className="h-4 w-4 text-slate-600" />
                      Product Performance Dynamics (Ice apple, Tomato, Mango etc.)
                    </h3>
                    <p className="text-4xs font-semibold text-slate-400 mt-0.5">Commodity specific volumes, revenue generated and unfulfilled losses</p>
                  </div>
                  <button
                    onClick={handlePdfChartGoods}
                    className="p-1.5 px-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-3xs font-bold flex items-center gap-1 border border-slate-200 transition-colors cursor-pointer"
                    title="Download underlying product sales statistics as PDF"
                    id="btn-download-chart4"
                  >
                    <FileText className="h-3 w-3 text-slate-400" />
                    Data PDF
                  </button>
                </div>

                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={goodsAggregated.slice(0, 7)} // Display top 7 commodities
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis 
                        type="number"
                        stroke="#94a3b8" 
                        fontSize={9} 
                        tickLine={false} 
                        tickFormatter={(val) => `${val} Kg/Unit`}
                      />
                      <YAxis 
                        type="category"
                        dataKey="goodName" 
                        stroke="#64748b" 
                        fontSize={9} 
                        width={75}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          fontSize: "11px", 
                          backgroundColor: "#ffffff", 
                          borderRadius: "8px", 
                          border: "1px solid #e2e8f0",
                          color: "#1e293b"
                        }}
                        formatter={(value: any, name: any) => {
                          if (name === "totalOrderedVolume") return [`${value} Units/Kgs`, "Total Ordered"];
                          if (name === "totalDeliveredVolume") return [`${value} Units/Kgs`, "Total Delivered"];
                          return [value, name];
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={24} 
                        iconSize={10} 
                        wrapperStyle={{ fontSize: "10px", marginTop: "10px" }} 
                      />
                      <Bar dataKey="totalOrderedVolume" name="totalOrderedVolume" fill="#cbd5e1" radius={[0, 4, 4, 0]} barSize={11} fillOpacity={0.5} />
                      <Bar dataKey="totalDeliveredVolume" name="totalDeliveredVolume" fill="#10b981" radius={[0, 4, 4, 0]} barSize={11} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

            {/* GOODS DETAILED BREAKDOWN DIRECTORY */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs" id="table-goods-summary">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-800 font-sans">Commodity Direct Ledger Summary</h3>
                  <p className="text-4xs font-semibold text-slate-400 mt-0.5">Summary values of products tracking for the selected period "{dateRangeLabel}"</p>
                </div>
                <div className="text-3xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                  Showing {goodsAggregated.length} unique commodities
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-3xs font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-3 pl-4">Product Name</th>
                      <th className="p-3 text-right">Ordered Vol</th>
                      <th className="p-3 text-right">Delivered Vol</th>
                      <th className="p-3 text-right">Revenue (Delivered)</th>
                      <th className="p-3 text-right text-rose-600 pr-4">Unfulfilled Loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs text-slate-600">
                    {goodsAggregated.map((gd) => {
                      const fullRate = gd.totalOrderedVolume > 0 ? (gd.totalDeliveredVolume / gd.totalOrderedVolume) * 100 : 100;
                      return (
                        <tr key={gd.goodName} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 pl-4 font-semibold text-slate-800 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-none" />
                            {gd.goodName}
                          </td>
                          <td className="p-3 text-right font-mono">{gd.totalOrderedVolume.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono">
                            <div>{gd.totalDeliveredVolume.toLocaleString()}</div>
                            <div className="text-4xs text-slate-400 font-semibold">{fullRate.toFixed(0)}% full rate</div>
                          </td>
                          <td className="p-3 text-right font-semibold font-mono text-slate-800">
                            {currencyFormatter(gd.revenue)}
                          </td>
                          <td className="p-3 text-right font-mono text-rose-600 pr-4">
                            {gd.loss > 0 ? currencyFormatter(gd.loss) : "Rs. 0"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RAW AUDIT DATA TABLE */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs" id="table-raw-audit">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-800 font-sans">Operational Sync Ledger Lines</h3>
                  <p className="text-4xs font-semibold text-slate-400 mt-0.5">Individual ledger line records parsed dynamically from the synced CSV sheet</p>
                </div>
                <div className="text-3xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                  Showing {filteredData.length} of {data.length} records
                </div>
              </div>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-left border-collapse table-fixed min-w-[750px]">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr className="border-b border-slate-200 text-3xs font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-3 pl-4 w-[110px] bg-slate-50">Date</th>
                      <th className="p-3 w-[150px] bg-slate-50">Commodity</th>
                      <th className="p-3 text-right w-[80px] bg-slate-50">Price</th>
                      <th className="p-3 text-right w-[100px] bg-slate-50">Ordered Vol</th>
                      <th className="p-3 text-right w-[110px] bg-slate-50">Delivered Vol</th>
                      <th className="p-3 text-right w-[110px] bg-slate-50">Revenue</th>
                      <th className="p-3 text-right w-[110px] text-rose-600 bg-slate-50">Loss</th>
                      <th className="p-3 text-right w-[110px] bg-slate-50">Paid</th>
                      <th className="p-3 text-right w-[110px] text-amber-600 pr-4 bg-slate-50">Owed Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs text-slate-600">
                    {filteredData.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 pl-4 font-mono font-medium text-slate-500 truncate">{row.date}</td>
                        <td className="p-3 font-semibold text-slate-800 truncate" title={row.good}>{row.good}</td>
                        <td className="p-3 text-right font-mono">Rs. {row.unitPrice.toFixed(1)}</td>
                        <td className="p-3 text-right font-mono">{row.orderedVolume}</td>
                        <td className="p-3 text-right font-mono">{row.deliveredVolume}</td>
                        <td className="p-3 text-right font-semibold font-mono text-slate-800">
                          {currencyFormatter(row.deliveredValue)}
                        </td>
                        <td className="p-3 text-right font-mono text-rose-600">
                          {row.potentialLoss > 0 ? currencyFormatter(row.potentialLoss) : "-"}
                        </td>
                        <td className="p-3 text-right font-mono">{currencyFormatter(row.paidAmount)}</td>
                        <td className={`p-3 text-right font-semibold font-mono pr-4 ${row.balancePayment > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                          {currencyFormatter(row.balancePayment)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* DAILY REPORT SUMMARY WIDGET (COPY TO WHATSAPP & EMAIL CHAT DISPATCH) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden text-white" id="dispatch-report-box">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <FileText className="h-32 w-32 text-slate-300" />
              </div>
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <span className="bg-emerald-500/10 text-emerald-300 text-3xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border border-emerald-500/20">
                    💡 Daily Ops Dispatch Copy-Board
                  </span>
                  <h3 className="text-base font-bold text-slate-100 mt-1.5 font-sans">
                    WhatsApp & Email Corporate Summary
                  </h3>
                  <p className="text-3xs text-slate-400 mt-0.5">
                    One-click live report generated from synced data logs to keep the group updated.
                  </p>
                </div>
                
                <button
                  onClick={copyToClipboard}
                  className={`px-4.5 py-2.5 rounded-xl text-3xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all shadow-sm ${
                    copied 
                      ? "bg-emerald-500 text-slate-950 font-black" 
                      : "bg-white hover:bg-slate-100 text-slate-900"
                  }`}
                  id="btn-copy-report"
                >
                  {copied ? (
                    <>
                      <Coins className="h-3.5 w-3.5" />
                      COPIED TO CLIPBOARD!
                    </>
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5 text-emerald-650" />
                      COPY FOR WHATSAPP / WHATSAPP WEB
                    </>
                  )}
                </button>
              </div>

              {/* RAW COPY PREVIEW CARD */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[10px] sm:text-xs text-slate-300 max-h-56 overflow-y-auto leading-relaxed shadow-inner">
                {whatsAppText.split("\n").map((line, i) => {
                  if (line.startsWith("*") && line.endsWith("*")) {
                    const cleanLine = line.replace(/\*/g, "");
                    return (
                      <p key={i} className="text-slate-100 font-bold mt-2 first:mt-0 text-3xs sm:text-2xs uppercase tracking-wider text-emerald-400 border-b border-slate-900 pb-0.5 mb-1">
                        {cleanLine}
                      </p>
                    );
                  }
                  // Handle line with middle bolding (e.g. • Total Ordered Value: *Rs. X*)
                  let content: ReactNode = line;
                  if (line.includes("*")) {
                    const parts = line.split("*");
                    content = parts.map((part, idx) => idx % 2 === 1 ? <strong className="text-slate-100 font-bold" key={idx}>{part}</strong> : part);
                  }
                  return <p key={i} className="pl-2">{content}</p>;
                })}
              </div>

              {/* OUTLIERS & RED FLAGS BOTTOM TIPS */}
              {scanAlerts.length > 0 && (
                <div className="mt-3.5 flex items-start gap-2 text-rose-300 text-4xs sm:text-3xs bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-rose-400 flex-none" />
                  <div className="flex-1">
                    <span className="font-bold text-rose-200">Critical Alerts Generated (7-Day Scope): </span>
                    {scanAlerts.length} shortfalls or payment balance gaps need instant attention on WhatsApp.
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 mt-12 py-5 text-slate-400 text-xs" id="footer-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="font-medium text-slate-500 font-sans">
            &copy; 2026 Niraipulam Agroproducts. All rights reserved.
          </p>
          <div className="flex items-center space-x-4">
            <span className="flex items-center gap-1 text-slate-400">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              Auto-sync intervals: updated every 12 hours.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
