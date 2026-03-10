import { join } from "@tauri-apps/api/path";
import type { Account, Category, Transaction } from "@/lib/types";
import type { BudgetRepository } from "@/repositories/types";
import {
  readCsv,
  writeCsvAtomic,
  createDebouncedWriter,
  ACCOUNT_COERCE,
  CATEGORY_COERCE,
  TRANSACTION_COERCE,
} from "@/services/csv";

export interface DisposableRepository extends BudgetRepository {
  dispose(): Promise<void>;
}

export function createCsvRepository(folderPath: string): DisposableRepository {
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
      paths[file] = await join(folderPath, `${file}.csv`);
    }
    return paths[file];
  }

  // Debounced writers — created lazily after first save
  const writers = {
    accounts: createDebouncedWriter(async () => {
      if (accounts) await writeCsvAtomic(await getPath("accounts"), accounts);
    }),
    categories: createDebouncedWriter(async () => {
      if (categories) await writeCsvAtomic(await getPath("categories"), categories);
    }),
    transactions: createDebouncedWriter(async () => {
      if (transactions) await writeCsvAtomic(await getPath("transactions"), transactions);
    }),
  };

  return {
    async getAccounts() {
      if (!accounts) {
        accounts = await readCsv<Account>(await getPath("accounts"), ACCOUNT_COERCE);
      }
      return accounts;
    },

    async getCategories() {
      if (!categories) {
        categories = await readCsv<Category>(await getPath("categories"), CATEGORY_COERCE);
      }
      return categories;
    },

    async getTransactions() {
      if (!transactions) {
        transactions = await readCsv<Transaction>(await getPath("transactions"), TRANSACTION_COERCE);
      }
      return transactions;
    },

    async saveAccounts(data: Account[]) {
      accounts = data;
      writers.accounts.schedule();
    },

    async saveCategories(data: Category[]) {
      categories = data;
      writers.categories.schedule();
    },

    async saveTransactions(data: Transaction[]) {
      transactions = data;
      writers.transactions.schedule();
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
