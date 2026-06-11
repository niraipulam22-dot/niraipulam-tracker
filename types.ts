export interface OperationsRow {
  id: string;
  date: string; // e.g., "11-Jun-26" or "2026-06-11"
  good: string; // e.g., "Ice Apple", "Pomegranate"
  orderedVolume: number; // e.g., in Kgs or units
  deliveredVolume: number;
  unitPrice: number; // rate per unit
  paidAmount: number; // actual amount paid
  orderedValue: number; // orderedVolume * unitPrice
  deliveredValue: number; // revenue = deliveredVolume * unitPrice
  potentialLoss: number; // (orderedVolume - deliveredVolume) * unitPrice
  balancePayment: number; // deliveredValue - paidAmount
  splitPaidAmount?: number; // equally divided merged value among merged cells
  rawRow?: string[];
}

export interface SummaryStats {
  totalRevenue: number;
  totalLoss: number;
  totalOrdersValue: number;
  totalPaid: number;
  totalBalanceDue: number;
  totalOrderedVolume: number;
  totalDeliveredVolume: number;
  fulfillmentRate: number;
}

export interface GoodsTracker {
  goodName: string;
  totalOrderedVolume: number;
  totalDeliveredVolume: number;
  revenue: number;
  loss: number;
  paid: number;
  due: number;
}
