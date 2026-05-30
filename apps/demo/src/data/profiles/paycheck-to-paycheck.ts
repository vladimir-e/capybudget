import type { DemoProfile } from "./types";
import { account, createCategories } from "./helpers";

const CHECKING = "p2p-checking";
const SAVINGS = "p2p-savings";
const CREDIT = "p2p-credit";

/** Paycheck to paycheck: a steady salaried earner whose income roughly matches
 *  outflow. A small fixed sweep to savings goes out each month but most of it is
 *  pulled back when the card payment lands, so the buffer stays thin and net
 *  worth ends near where it started. */
export const paycheckToPaycheck: DemoProfile = {
  id: "paycheck-to-paycheck",
  name: "Paycheck to Paycheck",
  description: "Income matches outflow, thin savings buffer, flat net worth",
  accounts: [
    account(CHECKING, "Checking", "checking", 0),
    account(SAVINGS, "Savings", "savings", 1),
    account(CREDIT, "Visa Card", "credit_card", 2),
  ],
  categories: createCategories(),
  openingBalances: {
    [CHECKING]: 120_000,
    [SAVINGS]: 60_000,
    [CREDIT]: -55_000,
  },

  incomeStreams: [
    {
      merchant: "Midwest Insurance Co",
      category: "Paycheck",
      accountId: CHECKING,
      cadence: "semimonthly",
      amount: 195_000,
      jitterPct: 0.02,
      dayOfMonth: 14,
    },
    {
      merchant: "Rover",
      category: "Other Income",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 9_000,
      jitterPct: 0.4,
      dayOfMonth: 22,
    },
  ],

  fixedBills: [
    {
      merchant: "Lakewood Apartments",
      category: "Housing",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 158_000,
      dayOfMonth: 1,
      note: "Rent",
    },
    {
      merchant: "Netflix",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 1_599,
      dayOfMonth: 5,
    },
    {
      merchant: "Spotify",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 1_099,
      dayOfMonth: 5,
    },
    {
      merchant: "Planet Fitness",
      category: "Health & Beauty",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 4_500,
      dayOfMonth: 5,
    },
    {
      merchant: "State Farm",
      category: "Transportation",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 18_000,
      dayOfMonth: 7,
      note: "Car insurance",
    },
  ],

  variableBills: [
    {
      merchant: "ComEd",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 13_000,
      jitterPct: 0.2,
      dayOfMonth: 3,
    },
    {
      merchant: "Xfinity",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 7_500,
      jitterPct: 0.05,
      dayOfMonth: 4,
    },
    {
      merchant: "T-Mobile",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 8_500,
      jitterPct: 0.04,
      dayOfMonth: 6,
    },
  ],

  variableExpenses: [
    {
      category: "Groceries",
      accountId: CREDIT,
      merchants: ["Kroger", "Aldi", "Costco", "Trader Joe's"],
      perMonth: [6, 9],
      amountRange: [6_500, 10_500],
    },
    {
      category: "Dining Out",
      accountId: CREDIT,
      merchants: ["Chipotle", "Applebee's", "Panera Bread", "Olive Garden", "Chick-fil-A"],
      perMonth: [5, 8],
      amountRange: [3_000, 7_500],
    },
    {
      category: "Transportation",
      accountId: CHECKING,
      merchants: ["Shell", "BP", "Speedway"],
      perMonth: [3, 5],
      amountRange: [4_000, 5_500],
    },
    {
      category: "Health & Beauty",
      accountId: CREDIT,
      merchants: ["CVS Pharmacy", "Walgreens", "Ulta Beauty"],
      perMonth: [1, 3],
      amountRange: [2_000, 5_000],
    },
  ],

  occasionalExpenses: [
    {
      category: "Clothing",
      accountId: CREDIT,
      merchants: ["Target", "Kohl's", "Old Navy", "TJ Maxx"],
      amountRange: [4_000, 12_000],
      probabilityPerMonth: 0.55,
    },
    {
      category: "Fun & Hobbies",
      accountId: CREDIT,
      merchants: ["AMC Theatres", "Steam", "REI", "Barnes & Noble"],
      amountRange: [2_500, 8_000],
      probabilityPerMonth: 0.6,
    },
    {
      category: "Alcohol & Smoking",
      accountId: CREDIT,
      merchants: ["Binny's", "Total Wine", "Costco"],
      amountRange: [2_500, 6_000],
      probabilityPerMonth: 0.5,
    },
    {
      category: "Allowances",
      accountId: CHECKING,
      merchants: ["ATM Withdrawal"],
      amountRange: [4_000, 8_000],
      probabilityPerMonth: 0.7,
    },
    {
      category: "Education & Business",
      accountId: CREDIT,
      merchants: ["Coursera", "LinkedIn Learning"],
      amountRange: [2_900, 5_900],
      probabilityPerMonth: 0.2,
    },
    {
      category: "Gifts & Giving",
      accountId: CREDIT,
      merchants: ["Amazon", "Target", "1-800-Flowers"],
      amountRange: [3_000, 9_000],
      probabilityPerMonth: 0.3,
    },
    {
      category: "Housekeeping & Maintenance",
      accountId: CREDIT,
      merchants: ["Home Depot", "Lowe's", "Ace Hardware"],
      amountRange: [2_500, 8_000],
      probabilityPerMonth: 0.3,
    },
    {
      category: "Big Purchases",
      accountId: CREDIT,
      merchants: ["Best Buy", "IKEA", "Wayfair"],
      amountRange: [25_000, 70_000],
      probabilityPerMonth: 0.12,
    },
    {
      category: "Travel",
      accountId: CREDIT,
      merchants: ["Southwest Airlines", "Marriott", "Airbnb"],
      amountRange: [20_000, 60_000],
      probabilityPerMonth: 0.12,
    },
    {
      category: "Taxes & Fees",
      accountId: CHECKING,
      merchants: ["Cook County", "DMV"],
      amountRange: [5_000, 15_000],
      probabilityPerMonth: 0.1,
    },
  ],

  transfers: [
    {
      fromAccountId: CHECKING,
      toAccountId: CREDIT,
      cadence: "monthly",
      amount: 90_000,
      jitterPct: 0.15,
      dayOfMonth: 27,
      note: "Credit card payment",
    },
    {
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      cadence: "monthly",
      amount: 8_000,
      dayOfMonth: 16,
      note: "Savings sweep",
    },
    {
      fromAccountId: SAVINGS,
      toAccountId: CHECKING,
      cadence: "monthly",
      amount: 6_000,
      dayOfMonth: 26,
      note: "Covering the gap",
    },
  ],
};
