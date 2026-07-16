import type { LedgerEntry, LedgerResponse } from "../shared/schemas.js";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(cell); if (row.some((item) => item.length)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell); if (row.some((item) => item.length)) rows.push(row); return rows;
}

function numberValue(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumberValue(value: string): number | null {
  return value.trim() ? numberValue(value) : null;
}

export function parseLedgerCsv(text: string, currency: string, modifiedAt: string): LedgerResponse {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((header) => header.trim().toLowerCase());
  const value = (row: string[], name: string) => row[headers.indexOf(name)]?.trim() ?? "";
  const entries: LedgerEntry[] = rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const grossAmount = optionalNumberValue(value(row, "gross amount"));
    const fee = optionalNumberValue(value(row, "fee"));
    const netAmount = optionalNumberValue(value(row, "net amount"));
    const amount = headers.includes("amount") ? numberValue(value(row, "amount")) : netAmount;
    const date = value(row, "date");
    const status = value(row, "status");
    const transactionId = value(row, "transaction id");
    const category = value(row, "category");
    const description = value(row, "description");
    const paymentExport = grossAmount !== null || netAmount !== null;
    const type = value(row, "type") || (paymentExport ? "Income" : "");
    const party = value(row, "party") || description.match(/\(([^()]+)\)\s*$/)?.[1] || "";
    const needsReview = !transactionId || amount === null || !date || Number.isNaN(new Date(`${date}T00:00:00`).getTime()) || !category || /needs? review|uncategorized/i.test(`${status} ${category}`);
    return {
      transactionId, date, type, businessLine: value(row, "business line"), project: value(row, "project"),
      party, description, category, amount, grossAmount, fee, tax: numberValue(value(row, "tax")),
      paymentMethod: value(row, "payment method"), status, sourceReference: value(row, "source reference"), notes: value(row, "notes"), needsReview,
    };
  });
  const income = entries.reduce((total, entry) => total + (entry.grossAmount ?? (/income|revenue|payment received|deposit|credit/i.test(entry.type) ? entry.amount ?? 0 : 0)), 0);
  const expenses = entries.reduce((total, entry) => total + (entry.fee !== null ? Math.abs(entry.fee) : (/expense|purchase|fee|refund|withdrawal|debit/i.test(entry.type) ? entry.amount ?? 0 : 0)), 0);
  return {
    source: "company/finance/transactions.csv", modifiedAt, currency, entries,
    summary: { income, expenses, net: income - expenses, transactionCount: entries.length, needsReview: entries.filter((entry) => entry.needsReview).length },
  };
}
