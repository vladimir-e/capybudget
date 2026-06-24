import type { DemoProfile } from "./types";
import { account, createCategories } from "./helpers";

const CHECKING = "uw-checking";
const CREDIT = "uw-credit";
const LOAN = "uw-loan";
const CASH = "uw-cash";
const BALI = "uw-bali";

/** Underwater: a service-industry earner whose two semimonthly paychecks barely
 *  cover the bills. The credit card carries everyday spend and only gets a small
 *  fixed payment each month — less than what goes onto it — so the balance
 *  trends up over the window. Negligible savings. */
export const underwater: DemoProfile = {
  id: "underwater",
  name: "Underwater",
  description: "Debt-heavy, negative net worth, balance trending the wrong way",
  accounts: [
    account(CHECKING, "Checking", "checking", 0),
    account(CREDIT, "Credit Card", "credit_card", 1),
    account(LOAN, "Student Loan", "loan", 2),
    account(CASH, "Cash", "cash", 3),
    // Travel cash from a trip to Bali, in rupiah. (1 USD ≈ 16,000 Rp.)
    account(BALI, "Bali Wallet", "cash", 4, "IDR"),
  ],
  categories: createCategories(),
  openingBalances: {
    [CHECKING]: 50_000,
    [CREDIT]: -420_000,
    [LOAN]: -2_650_000,
    [CASH]: 20_000,
    [BALI]: 200_000_000, // 2,000,000 Rp
  },

  incomeStreams: [
    {
      merchant: "Riverside Grill",
      category: "Paycheck",
      accountId: CHECKING,
      cadence: "semimonthly",
      amount: 122_000,
      jitterPct: 0.05,
      dayOfMonth: 13,
    },
    {
      merchant: "DoorDash",
      category: "Other Income",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 9_000,
      jitterPct: 0.4,
      dayOfMonth: 20,
    },
  ],

  fixedBills: [
    {
      merchant: "Oak Park Apartments",
      category: "Housing",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 95_000,
      dayOfMonth: 1,
      note: "Rent",
    },
    {
      merchant: "Spotify",
      category: "Subscriptions",
      accountId: CREDIT,
      cadence: "monthly",
      amount: 1_099,
      dayOfMonth: 25,
    },
    {
      merchant: "State Farm",
      category: "Transportation",
      accountId: CHECKING,
      cadence: "monthly",
      amount: 18_000,
      dayOfMonth: 10,
      note: "Car insurance",
    },
  ],

  variableBills: [
    {
      merchant: "Duke Energy",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 8_800,
      jitterPct: 0.18,
      dayOfMonth: 5,
    },
    {
      merchant: "AT&T",
      category: "Bills & Utilities",
      accountId: CHECKING,
      amount: 6_500,
      jitterPct: 0.06,
      dayOfMonth: 6,
    },
  ],

  variableExpenses: [
    {
      category: "Groceries",
      accountId: CREDIT,
      merchants: ["Aldi", "Dollar General", "Walmart", "Save A Lot"],
      perMonth: [5, 7],
      amountRange: [4_500, 7_500],
    },
    {
      category: "Dining Out",
      accountId: CREDIT,
      merchants: ["McDonald's", "Taco Bell", "Subway", "Wendy's", "Little Caesars"],
      perMonth: [5, 8],
      amountRange: [900, 2_400],
    },
    {
      category: "Transportation",
      accountId: CREDIT,
      merchants: ["Speedway", "Circle K", "Shell", "Marathon"],
      perMonth: [3, 5],
      amountRange: [3_800, 5_400],
    },
    {
      category: "Health & Beauty",
      accountId: CASH,
      merchants: ["Dollar General", "CVS", "Great Clips"],
      perMonth: [1, 2],
      amountRange: [1_200, 3_000],
    },
    {
      category: "Alcohol & Smoking",
      accountId: CASH,
      merchants: ["Circle K", "Speedway", "Total Wine"],
      perMonth: [2, 4],
      amountRange: [1_500, 3_500],
    },
    // Bali wallet spend-down, all in rupiah. Travel dining, transport, and
    // shopping that quietly bleeds the trip cash.
    {
      category: "Dining Out",
      accountId: BALI,
      merchants: ["Warung Bu Mi", "Sari Organik", "La Favela", "Kopi Kenangan"],
      perMonth: [3, 5],
      amountRange: [60_000, 150_000],
    },
    {
      category: "Transportation",
      accountId: BALI,
      merchants: ["Gojek", "Grab", "Blue Bird"],
      perMonth: [2, 3],
      amountRange: [40_000, 90_000],
    },
    {
      category: "Fun & Hobbies",
      accountId: BALI,
      merchants: ["Ubud Market", "Pantai Surf Shop", "Bintang Supermarket"],
      perMonth: [1, 2],
      amountRange: [100_000, 250_000],
    },
  ],

  occasionalExpenses: [
    {
      category: "Clothing",
      accountId: CREDIT,
      merchants: ["Walmart", "Ross", "Old Navy"],
      amountRange: [2_500, 6_500],
      probabilityPerMonth: 0.4,
    },
    {
      category: "Fun & Hobbies",
      accountId: CREDIT,
      merchants: ["GameStop", "AMC Theatres", "Dave & Buster's"],
      amountRange: [1_500, 4_500],
      probabilityPerMonth: 0.5,
    },
    {
      category: "Allowances",
      accountId: CASH,
      merchants: ["Laundromat", "Barber Shop"],
      amountRange: [2_000, 4_000],
      probabilityPerMonth: 0.6,
    },
    {
      category: "Education & Business",
      accountId: CREDIT,
      merchants: ["Udemy", "Coursera"],
      amountRange: [1_500, 4_000],
      probabilityPerMonth: 0.15,
    },
    {
      category: "Gifts & Giving",
      accountId: CREDIT,
      merchants: ["Walmart", "Target", "Amazon"],
      amountRange: [2_000, 5_000],
      probabilityPerMonth: 0.2,
    },
    {
      category: "Housekeeping & Maintenance",
      accountId: CREDIT,
      merchants: ["Home Depot", "Ace Hardware"],
      amountRange: [1_500, 5_000],
      probabilityPerMonth: 0.2,
    },
    {
      category: "Big Purchases",
      accountId: CREDIT,
      merchants: ["Best Buy", "Pep Boys"],
      amountRange: [15_000, 45_000],
      probabilityPerMonth: 0.1,
    },
    {
      category: "Travel",
      accountId: CREDIT,
      merchants: ["Greyhound", "Motel 6"],
      amountRange: [8_000, 22_000],
      probabilityPerMonth: 0.08,
    },
    {
      category: "Taxes & Fees",
      accountId: CHECKING,
      merchants: ["NSF Fee", "Late Fee"],
      amountRange: [3_500, 3_500],
      probabilityPerMonth: 0.3,
    },
  ],

  transfers: [
    {
      fromAccountId: CHECKING,
      toAccountId: CREDIT,
      cadence: "monthly",
      amount: 22_000,
      dayOfMonth: 27,
      note: "Credit card payment",
    },
    {
      fromAccountId: CHECKING,
      toAccountId: LOAN,
      cadence: "monthly",
      amount: 25_000,
      dayOfMonth: 27,
      note: "Student loan payment",
    },
    // Funds the cash spending above; sized over its worst-case month ($240).
    {
      fromAccountId: CHECKING,
      toAccountId: CASH,
      cadence: "biweekly",
      amount: 13_000,
      note: "ATM withdrawal",
    },
    // Tops up the Bali wallet from USD checking: $50 → ~800,000 Rp, biweekly,
    // sized to clear the rupiah spend-down above without going negative.
    {
      fromAccountId: CHECKING,
      toAccountId: BALI,
      cadence: "biweekly",
      amount: 5_000,
      note: "Travel cash",
    },
  ],
};
