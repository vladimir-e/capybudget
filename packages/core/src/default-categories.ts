import type { Category } from "./types";

export const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Paycheck", group: "Income", archived: false, sortOrder: 0, assigned: null },
  { name: "Other Income", group: "Income", archived: false, sortOrder: 1, assigned: null },
  { name: "Housing", group: "Fixed", archived: false, sortOrder: 0, assigned: null },
  { name: "Bills & Utilities", group: "Fixed", archived: false, sortOrder: 1, assigned: null },
  { name: "Subscriptions", group: "Fixed", archived: false, sortOrder: 2, assigned: null },
  { name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
  { name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
  { name: "Transportation", group: "Daily Living", archived: false, sortOrder: 2, assigned: null },
  { name: "Alcohol & Smoking", group: "Personal", archived: false, sortOrder: 0, assigned: null },
  { name: "Health & Beauty", group: "Personal", archived: false, sortOrder: 1, assigned: null },
  { name: "Clothing", group: "Personal", archived: false, sortOrder: 2, assigned: null },
  { name: "Fun & Hobbies", group: "Personal", archived: false, sortOrder: 3, assigned: null },
  { name: "Allowances", group: "Personal", archived: false, sortOrder: 4, assigned: null },
  { name: "Education & Business", group: "Personal", archived: false, sortOrder: 5, assigned: null },
  { name: "Gifts & Giving", group: "Personal", archived: false, sortOrder: 6, assigned: null },
  { name: "Housekeeping & Maintenance", group: "Irregular", archived: false, sortOrder: 0, assigned: null },
  { name: "Big Purchases", group: "Irregular", archived: false, sortOrder: 1, assigned: null },
  { name: "Travel", group: "Irregular", archived: false, sortOrder: 2, assigned: null },
  { name: "Taxes & Fees", group: "Irregular", archived: false, sortOrder: 3, assigned: null },
];
