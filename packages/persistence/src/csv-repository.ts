import type { Account, Category, Transaction } from "@capybudget/core";
import type { FileAdapter } from "./file-adapter";
import type { BudgetRepository } from "./repository";
import {
  parseCsv,
  unparseCsv,
  ACCOUNT_COERCE,
  CATEGORY_COERCE,
  TRANSACTION_COERCE,
} from "./csv-parse";
import { createDebouncedWriter } from "./debounced-writer";

export interface DisposableRepository extends BudgetRepository {
  /** Clear in-memory cache so next get*() re-reads from disk. */
  invalidateCache(): void;
  dispose(): Promise<void>;
}

/** Write data to a CSV file atomically (write .tmp then rename). */
async function writeCsvAtomic(
  filePath: string,
  data: unknown[],
  fileAdapter: FileAdapter,
): Promise<void> {
  const csv = unparseCsv(data);
  const tmpPath = `${filePath}.tmp`;
  await fileAdapter.writeFile(tmpPath, csv);
  await fileAdapter.rename(tmpPath, filePath);
}

export function createCsvRepository(
  folderPath: string,
  fileAdapter: FileAdapter,
  options?: { immediate?: boolean },
): DisposableRepository {
  let accounts: Account[] | null = null;
  let categories: Category[] | null = null;
  let transactions: Transaction[] | null = null;

  // Lazy-resolved file paths
  const paths = {
    accounts: null as string | null,
    categories: null as string | null,
    transactions: null as string | null,
  };

  async function getPath(file: "accounts" | "categories" | "transactions") {
    if (!paths[file]) {
      paths[file] = await fileAdapter.join(folderPath, `${file}.csv`);
    }
    return paths[file];
  }

  // Debounced writers — created lazily after first save
  const writers = {
    accounts: createDebouncedWriter(async () => {
      if (accounts) await writeCsvAtomic(await getPath("accounts"), accounts, fileAdapter);
    }),
    categories: createDebouncedWriter(async () => {
      if (categories) await writeCsvAtomic(await getPath("categories"), categories, fileAdapter);
    }),
    transactions: createDebouncedWriter(async () => {
      if (transactions) await writeCsvAtomic(await getPath("transactions"), transactions, fileAdapter);
    }),
  };

  return {
    async getAccounts() {
      if (!accounts) {
        const content = await fileAdapter.readFile(await getPath("accounts"));
        accounts = parseCsv<Account>(content, ACCOUNT_COERCE);
      }
      return accounts;
    },

    async getCategories() {
      if (!categories) {
        const content = await fileAdapter.readFile(await getPath("categories"));
        categories = parseCsv<Category>(content, CATEGORY_COERCE);
      }
      return categories;
    },

    async getTransactions() {
      if (!transactions) {
        const content = await fileAdapter.readFile(await getPath("transactions"));
        transactions = parseCsv<Transaction>(content, TRANSACTION_COERCE);
      }
      return transactions;
    },

    async saveAccounts(data: Account[]) {
      accounts = data;
      if (options?.immediate) await writers.accounts.flush();
      else writers.accounts.schedule();
    },

    async saveCategories(data: Category[]) {
      categories = data;
      if (options?.immediate) await writers.categories.flush();
      else writers.categories.schedule();
    },

    async saveTransactions(data: Transaction[]) {
      transactions = data;
      if (options?.immediate) await writers.transactions.flush();
      else writers.transactions.schedule();
    },

    invalidateCache() {
      accounts = null;
      categories = null;
      transactions = null;
    },

    async dispose() {
      await Promise.all([
        writers.accounts.flush(),
        writers.categories.flush(),
        writers.transactions.flush(),
      ]);
    },
  };
}
