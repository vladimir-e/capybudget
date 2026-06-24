import type { DemoProfile } from "./types";
import { account, createCategories } from "./helpers";

const CHECKING = "ns-checking";
const SAVINGS = "ns-savings";
const BROKERAGE = "ns-brokerage";
const CREDIT = "ns-credit";
const CASH = "ns-cash";
const SWISS = "ns-swiss";

/** No stress: a high earner whose income comfortably clears a generous lifestyle.
 *  Every month a large fixed sweep moves to high-yield savings and a brokerage
 *  contribution goes out, so investable assets — and net worth — climb steadily
 *  across the window even after premium spending. */
export const noStress: DemoProfile = {
  id: "no-stress",
  name: "No Stress",
  description: "High earner, money flows to savings and brokerage, net worth climbs",
  accounts: [
    account(CHECKING, "Checking", "checking", 0),
    account(SAVINGS, "High-Yield Savings", "savings", 1),
    account(BROKERAGE, "Brokerage", "asset", 2),
    account(CREDIT, "Amex Platinum", "credit_card", 3),
    account(CASH, "Cash", "cash", 4),
    // Offshore franc savings. (1 USD ≈ 0.88 CHF.)
    account(SWISS, "Swiss Account", "savings", 5, "CHF"),
  ],
  categories: createCategories(),
  openingBalances: {
    [CHECKING]: 1_800_000,
    [SAVINGS]: 8_500_000,
    [BROKERAGE]: 18_000_000,
    [CREDIT]: -350_000,
    [CASH]: 50_000,
    [SWISS]: 1_000_000, // 10,000 CHF
  },

  incomeStreams: [
    {
      merchant: "TechVenture Inc",
      category: "Paycheck",
      accountId: CHECKING,
      cadence: "semimonthly",
      amount: 700_000,
      jitterPct: 0.02,
      dayOfMonth: 14,
    },
    {
      merchant: "Fidelity",
      category: "Other Income",
      accountId: BROKERAGE,
      cadence: "monthly",
      amount: 22_000,
      jitterPct: 0.25,
      dayOfMonth: 28,
    },
    {
      // Interest on the franc balance. ~40 CHF/mo.
      merchant: "UBS",
      category: "Other Income",
      accountId: SWISS,
      cadence: "monthly",
      amount: 4_000,
      jitterPct: 0.2,
      dayOfMonth: 28,
    },
  ],

  fixedBills: [
    {
      merchant: "Wells Fargo Mortgage",
      category: "Housing",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 380_000,
      dayOfMonth: 1,
      note: "Mortgage",
    },
    {
      merchant: "Netflix Premium",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 2_299,
      dayOfMonth: 5,
    },
    {
      merchant: "Spotify Family",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 1_699,
      dayOfMonth: 5,
    },
    {
      merchant: "The New York Times",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 1_700,
      dayOfMonth: 5,
    },
    {
      merchant: "Equinox",
      category: "Health & Beauty",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 15_000,
      dayOfMonth: 5,
    },
  ],

  variableBills: [
    {
      merchant: "PG&E",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 18_500,
      jitterPct: 0.15,
      dayOfMonth: 2,
    },
    {
      merchant: "Comcast",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 12_000,
      jitterPct: 0.05,
      dayOfMonth: 3,
    },
  ],

  variableExpenses: [
    {
      category: "Groceries",
      accountId: CREDIT,
      merchants: ["Whole Foods", "Erewhon", "Trader Joe's", "Bristol Farms"],
      perMonth: [5, 8],
      amountRange: [12_000, 19_000],
    },
    {
      category: "Dining Out",
      accountId: CREDIT,
      merchants: ["Nobu", "The French Laundry", "Catch", "Le Bernardin", "Masa", "Per Se"],
      perMonth: [4, 7],
      amountRange: [18_000, 42_000],
    },
    {
      category: "Transportation",
      accountId: CREDIT,
      merchants: ["Uber", "Lyft", "Chevron", "Tesla Supercharger"],
      perMonth: [4, 6],
      amountRange: [4_500, 9_500],
    },
  ],

  occasionalExpenses: [
    {
      category: "Clothing",
      accountId: CREDIT,
      merchants: ["Nordstrom", "Apple Store", "Bloomingdale's", "Gucci"],
      amountRange: [25_000, 75_000],
      probabilityPerMonth: 0.7,
    },
    {
      category: "Fun & Hobbies",
      accountId: CREDIT,
      merchants: ["SoulCycle", "Topgolf", "Ticketmaster", "Sotheby's"],
      amountRange: [8_500, 30_000],
      probabilityPerMonth: 0.7,
    },
    {
      category: "Alcohol & Smoking",
      accountId: CREDIT,
      merchants: ["K&L Wine Merchants", "The Wine Club"],
      amountRange: [6_000, 18_000],
      probabilityPerMonth: 0.5,
    },
    {
      category: "Allowances",
      accountId: CASH,
      merchants: ["Farmers Market", "Valet Parking", "Barbershop"],
      amountRange: [10_000, 20_000],
      probabilityPerMonth: 0.6,
    },
    {
      category: "Education & Business",
      accountId: CREDIT,
      merchants: ["MasterClass", "Y Combinator", "AWS"],
      amountRange: [5_000, 25_000],
      probabilityPerMonth: 0.35,
    },
    {
      category: "Gifts & Giving",
      accountId: CREDIT,
      merchants: ["Tiffany & Co.", "Amazon", "Red Cross"],
      amountRange: [10_000, 40_000],
      probabilityPerMonth: 0.4,
    },
    {
      category: "Housekeeping & Maintenance",
      accountId: CREDIT,
      merchants: ["Merry Maids", "Restoration Hardware", "Handy"],
      amountRange: [8_000, 25_000],
      probabilityPerMonth: 0.45,
    },
    {
      category: "Big Purchases",
      accountId: CREDIT,
      merchants: ["Apple Store", "B&H Photo", "Design Within Reach"],
      amountRange: [80_000, 250_000],
      probabilityPerMonth: 0.18,
    },
    {
      category: "Travel",
      accountId: CREDIT,
      merchants: ["Delta Airlines", "Four Seasons", "Singapore Airlines", "Airbnb"],
      amountRange: [60_000, 220_000],
      probabilityPerMonth: 0.3,
    },
    {
      category: "Taxes & Fees",
      accountId: CHECKING,
      merchants: ["IRS", "FTB", "CPA Associates"],
      amountRange: [40_000, 150_000],
      probabilityPerMonth: 0.12,
    },
  ],

  transfers: [
    {
      fromAccountId: CHECKING,
      toAccountId: CREDIT,
      cadence: "monthly",
      amount: 300_000,
      jitterPct: 0.2,
      dayOfMonth: 27,
      note: "Credit card payment",
    },
    {
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      cadence: "monthly",
      amount: 250_000,
      dayOfMonth: 16,
      note: "Savings sweep",
    },
    {
      fromAccountId: CHECKING,
      toAccountId: BROKERAGE,
      cadence: "monthly",
      amount: 200_000,
      dayOfMonth: 16,
      note: "Brokerage contribution",
    },
    // Funds the cash spending above; sized over its worst-case month ($200).
    {
      fromAccountId: CHECKING,
      toAccountId: CASH,
      cadence: "monthly",
      amount: 25_000,
      dayOfMonth: 10,
      note: "ATM withdrawal",
    },
    {
      // Monthly offshore sweep: $2,000 from USD checking lands as ~1,760 CHF,
      // so the franc holdings climb across the window.
      fromAccountId: CHECKING,
      toAccountId: SWISS,
      cadence: "monthly",
      amount: 200_000,
      dayOfMonth: 16,
      note: "Swiss sweep",
    },
  ],
};
