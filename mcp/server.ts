import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join } from "path";
import Papa from "papaparse";

// ── Budget path ──────────────────────────────────────────────────

const BUDGET_PATH = process.env.BUDGET_PATH;
if (!BUDGET_PATH) {
  throw new Error("BUDGET_PATH environment variable is required");
}

// ── Types (mirrors src/lib/types.ts — no import to avoid Vite deps) ──

interface Account {
  id: string;
  name: string;
  type: string;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
  group: string;
  archived: boolean;
  sortOrder: number;
}

interface Transaction {
  id: string;
  datetime: string;
  type: string;
  amount: number;
  categoryId: string;
  accountId: string;
  transferPairId: string;
  merchant: string;
  note: string;
  createdAt: string;
}

// ── CSV reading (Node fs, mirrors src/services/csv.ts pattern) ───

type Coerce = Record<string, (v: string) => unknown>;

function readCsv<T>(filename: string, coerce: Coerce): T[] {
  const filePath = join(BUDGET_PATH, filename);
  const raw = readFileSync(filePath, "utf-8");
  const { data } = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  });
  return data.map((row) => {
    const typed = { ...row } as Record<string, unknown>;
    for (const [key, fn] of Object.entries(coerce)) {
      if (key in typed) typed[key] = fn(row[key]);
    }
    return typed as T;
  });
}

const toBool = (v: string) => v === "true";
const toInt = (v: string) => parseInt(v, 10);

function getAccounts(): Account[] {
  return readCsv<Account>("accounts.csv", {
    archived: toBool,
    sortOrder: toInt,
  });
}

function getCategories(): Category[] {
  return readCsv<Category>("categories.csv", {
    archived: toBool,
    sortOrder: toInt,
  });
}

function getTransactions(): Transaction[] {
  return readCsv<Transaction>("transactions.csv", { amount: toInt });
}

// ── Helpers ──────────────────────────────────────────────────────

function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${String(remainder).padStart(2, "0")}`;
}

function accountBalance(accountId: string, transactions: Transaction[]): number {
  return transactions
    .filter((t) => t.accountId === accountId)
    .reduce((sum, t) => sum + t.amount, 0);
}

// ── Tool definitions ─────────────────────────────────────────────

const DATA_TOOLS = [
  {
    name: "list_accounts",
    description:
      "List all accounts with their current balances. Returns account name, type, balance, and whether it's archived.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_transactions",
    description:
      "List transactions with optional filters. Amounts are in cents (negative = expense). Dates are ISO strings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountId: {
          type: "string",
          description: "Filter by account ID",
        },
        categoryId: {
          type: "string",
          description: "Filter by category ID",
        },
        merchant: {
          type: "string",
          description: "Filter by merchant name (case-insensitive substring match)",
        },
        startDate: {
          type: "string",
          description: "Filter transactions on or after this date (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Filter transactions on or before this date (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (default: 50)",
        },
      },
    },
  },
  {
    name: "list_categories",
    description:
      "List all categories grouped by type (Income, Fixed, Daily Living, Personal, Irregular).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "spending_summary",
    description:
      "Get spending aggregated by category for a date range. Returns category name, transaction count, and total amount.",
    inputSchema: {
      type: "object" as const,
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD). Defaults to first day of current month.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },
];

const RENDER_TOOLS = [
  {
    name: "render_table",
    description:
      "Render a data table in the UI. Use this instead of markdown tables. The frontend will display it as a styled, interactive table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Column header labels",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description:
            "Table rows. Each row is an array of cell strings. Prefix amounts with $ for formatting.",
        },
      },
      required: ["headers", "rows"],
    },
  },
  {
    name: "render_bar_chart",
    description:
      "Render a horizontal bar chart in the UI. Use for comparing values across categories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Chart title" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
          description: "Data points. Values should be positive numbers (dollars, not cents).",
        },
      },
      required: ["title", "data"],
    },
  },
  {
    name: "render_donut_chart",
    description:
      "Render a donut/pie chart in the UI. Use for showing proportions and distributions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Chart title" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
          description: "Data points. Values should be positive numbers (dollars, not cents).",
        },
      },
      required: ["title", "data"],
    },
  },
];

// ── Tool handlers ────────────────────────────────────────────────

function handleListAccounts() {
  const accounts = getAccounts();
  const transactions = getTransactions();

  const result = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: formatMoney(accountBalance(a.id, transactions)),
    balanceCents: accountBalance(a.id, transactions),
    archived: a.archived,
  }));

  return JSON.stringify(result, null, 2);
}

function handleListTransactions(args: Record<string, unknown>) {
  let txns = getTransactions();
  const accounts = getAccounts();
  const categories = getCategories();

  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  if (args.accountId) {
    txns = txns.filter((t) => t.accountId === args.accountId);
  }
  if (args.categoryId) {
    txns = txns.filter((t) => t.categoryId === args.categoryId);
  }
  if (args.merchant) {
    const q = (args.merchant as string).toLowerCase();
    txns = txns.filter((t) => t.merchant.toLowerCase().includes(q));
  }
  if (args.startDate) {
    txns = txns.filter((t) => t.datetime >= (args.startDate as string));
  }
  if (args.endDate) {
    txns = txns.filter((t) => t.datetime <= (args.endDate as string) + "T23:59:59");
  }

  // Sort newest first
  txns.sort((a, b) => b.datetime.localeCompare(a.datetime));

  const limit = (args.limit as number) || 50;
  txns = txns.slice(0, limit);

  const result = txns.map((t) => ({
    id: t.id,
    date: t.datetime.slice(0, 10),
    type: t.type,
    amount: formatMoney(t.amount),
    amountCents: t.amount,
    account: accountMap.get(t.accountId) ?? t.accountId,
    category: categoryMap.get(t.categoryId) ?? (t.categoryId || "Uncategorized"),
    merchant: t.merchant || "(none)",
    note: t.note || "",
  }));

  return JSON.stringify(result, null, 2);
}

function handleListCategories() {
  const categories = getCategories();

  const grouped: Record<string, { id: string; name: string; archived: boolean }[]> = {};
  for (const c of categories) {
    const group = c.group || "Other";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ id: c.id, name: c.name, archived: c.archived });
  }

  return JSON.stringify(grouped, null, 2);
}

function handleSpendingSummary(args: Record<string, unknown>) {
  const now = new Date();
  const startDate =
    (args.startDate as string) ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const endDate =
    (args.endDate as string) ?? now.toISOString().slice(0, 10);

  const transactions = getTransactions();
  const categories = getCategories();
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const expenses = transactions.filter(
    (t) =>
      t.type === "expense" &&
      t.datetime >= startDate &&
      t.datetime <= endDate + "T23:59:59",
  );

  const byCat = new Map<string, { count: number; totalCents: number }>();
  for (const t of expenses) {
    const catName = categoryMap.get(t.categoryId) ?? (t.categoryId || "Uncategorized");
    const entry = byCat.get(catName) ?? { count: 0, totalCents: 0 };
    entry.count++;
    entry.totalCents += t.amount; // negative cents
    byCat.set(catName, entry);
  }

  const result = [...byCat.entries()]
    .sort((a, b) => a[1].totalCents - b[1].totalCents) // most negative first
    .map(([category, { count, totalCents }]) => ({
      category,
      transactions: count,
      total: formatMoney(totalCents),
      totalCents,
    }));

  return JSON.stringify(
    { period: `${startDate} to ${endDate}`, spending: result },
    null,
    2,
  );
}

// ── Server setup ─────────────────────────────────────────────────

const server = new Server(
  { name: "capy", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...DATA_TOOLS, ...RENDER_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Render tools are no-ops — the frontend intercepts the tool_use event
  if (name.startsWith("render_")) {
    return { content: [{ type: "text", text: "Rendered." }] };
  }

  let text: string;
  switch (name) {
    case "list_accounts":
      text = handleListAccounts();
      break;
    case "list_transactions":
      text = handleListTransactions(args ?? {});
      break;
    case "list_categories":
      text = handleListCategories();
      break;
    case "spending_summary":
      text = handleSpendingSummary(args ?? {});
      break;
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }

  return { content: [{ type: "text", text }] };
});

// ── Start ────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
