import type { Category } from "@/lib/types";

export const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Paycheck", group: "Income", archived: false, sortOrder: 0 },
  { name: "Other Income", group: "Income", archived: false, sortOrder: 1 },
  { name: "Housing", group: "Fixed", archived: false, sortOrder: 0 },
  { name: "Bills & Utilities", group: "Fixed", archived: false, sortOrder: 1 },
  { name: "Subscriptions", group: "Fixed", archived: false, sortOrder: 2 },
  { name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0 },
  { name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1 },
  { name: "Transportation", group: "Daily Living", archived: false, sortOrder: 2 },
  { name: "Alcohol & Smoking", group: "Personal", archived: false, sortOrder: 0 },
  { name: "Health & Beauty", group: "Personal", archived: false, sortOrder: 1 },
  { name: "Clothing", group: "Personal", archived: false, sortOrder: 2 },
  { name: "Fun & Hobbies", group: "Personal", archived: false, sortOrder: 3 },
  { name: "Allowances", group: "Personal", archived: false, sortOrder: 4 },
  { name: "Education & Business", group: "Personal", archived: false, sortOrder: 5 },
  { name: "Gifts & Giving", group: "Personal", archived: false, sortOrder: 6 },
  { name: "Housekeeping & Maintenance", group: "Irregular", archived: false, sortOrder: 0 },
  { name: "Big Purchases", group: "Irregular", archived: false, sortOrder: 1 },
  { name: "Travel", group: "Irregular", archived: false, sortOrder: 2 },
  { name: "Taxes & Fees", group: "Irregular", archived: false, sortOrder: 3 },
];
