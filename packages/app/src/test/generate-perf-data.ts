import { faker } from "@faker-js/faker";
import { makeAccount, makeCategory, makeTransaction } from "./factories";
import type { Account, Category, Transaction, AccountType, CategoryGroup } from "@capybudget/core";
import type { MemoryRepositoryData } from "@capybudget/persistence";

const accountDefs: { name: string; type: AccountType }[] = [
  { name: "Checking", type: "checking" },
  { name: "Savings", type: "savings" },
  { name: "Cash", type: "cash" },
  { name: "Chase Sapphire", type: "credit_card" },
  { name: "Amex Gold", type: "credit_card" },
  { name: "Crypto Wallet", type: "crypto" },
  { name: "Emergency Fund", type: "savings" },
  { name: "Car Loan", type: "loan" },
];

const categoryDefs: { name: string; group: CategoryGroup }[] = [
  { name: "Salary", group: "Income" },
  { name: "Freelance", group: "Income" },
  { name: "Rent", group: "Fixed" },
  { name: "Utilities", group: "Fixed" },
  { name: "Insurance", group: "Fixed" },
  { name: "Groceries", group: "Daily Living" },
  { name: "Restaurants", group: "Daily Living" },
  { name: "Coffee", group: "Daily Living" },
  { name: "Transport", group: "Daily Living" },
  { name: "Gas", group: "Daily Living" },
  { name: "Clothing", group: "Personal" },
  { name: "Entertainment", group: "Personal" },
  { name: "Subscriptions", group: "Personal" },
  { name: "Medical", group: "Irregular" },
  { name: "Travel", group: "Irregular" },
];

export function generatePerfData(txnCount: number): Required<MemoryRepositoryData> {
  faker.seed(42); // deterministic output

  const accounts: Account[] = accountDefs.map((def, i) =>
    makeAccount({ id: `perf-acc-${i}`, name: def.name, type: def.type, sortOrder: i }),
  );

  const categories: Category[] = categoryDefs.map((def, i) =>
    makeCategory({ id: `perf-cat-${i}`, name: def.name, group: def.group, sortOrder: i }),
  );

  const transactions: Transaction[] = Array.from({ length: txnCount }, (_, i) => {
    const account = faker.helpers.arrayElement(accounts);
    const category = faker.helpers.arrayElement(categories);
    const isIncome = category.group === "Income";
    const amount = isIncome
      ? faker.number.int({ min: 100_00, max: 10_000_00 })
      : -faker.number.int({ min: 1_00, max: 500_00 });
    const date = faker.date.between({ from: "2024-01-01", to: "2025-12-31" });
    const datetime = date.toISOString();

    return makeTransaction({
      id: `perf-txn-${i}`,
      datetime,
      type: isIncome ? "income" : "expense",
      amount,
      categoryId: category.id,
      accountId: account.id,
      merchant: faker.company.name(),
      createdAt: datetime,
    });
  });

  return { accounts, categories, transactions };
}
