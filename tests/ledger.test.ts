import { describe, expect, it } from "vitest";
import { parseLedgerCsv } from "../src/server/ledger.js";

const header = "Transaction ID,Date,Type,Business Line,Project,Party,Description,Category,Amount,Tax,Payment Method,Status,Source Reference,Notes";

describe("accounting ledger view model", () => {
  it("calculates cash movement and preserves quoted CSV values", () => {
    const csv = `${header}\nTX-1,2026-07-01,Income,Samuel.Studio.dev,Puppy Wash,Ed Christoffersen,"Website, booking system",Website Revenue,999,0,Card,Completed,INV-1,Deposit\nTX-2,2026-07-02,Expense,Samuel.Studio,Studio,"Vendor, Inc.",Software subscription,Software,49,3.43,Card,Completed,RCPT-2,Monthly\n`;
    const ledger = parseLedgerCsv(csv, "USD", "2026-07-15T12:00:00.000Z");
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[0].description).toBe("Website, booking system");
    expect(ledger.summary).toMatchObject({ income: 999, expenses: 49, net: 950, transactionCount: 2, needsReview: 0 });
  });

  it("returns an empty live ledger for a header-only source and flags malformed entries", () => {
    expect(parseLedgerCsv(`${header}\n`, "USD", "2026-07-15T12:00:00.000Z").summary.transactionCount).toBe(0);
    const malformed = parseLedgerCsv(`${header}\n,bad-date,Expense,,,,,Uncategorized,nope,,,,,\n`, "USD", "2026-07-15T12:00:00.000Z");
    expect(malformed.entries[0]).toMatchObject({ amount: null, needsReview: true });
    expect(malformed.summary.needsReview).toBe(1);
  });

  it("maps approved PayPal-style gross, fee, and net exports into ledger totals", () => {
    const csv = "Date,Transaction ID,Gross Amount,Fee,Net Amount,Category,Description,Status\n2026-06-24,8Y403115W1108294D,20.00,-1.19,18.81,Website Services,Recurring: Business Website (Laura Ediger),Completed\n";
    const ledger = parseLedgerCsv(csv, "USD", "2026-07-15T12:00:00.000Z");
    expect(ledger.entries[0]).toMatchObject({ type: "Income", party: "Laura Ediger", amount: 18.81, grossAmount: 20, fee: -1.19, needsReview: false });
    expect(ledger.summary).toMatchObject({ income: 20, expenses: 1.19, net: 18.81 });
  });
});
