// Types
export type {
  BudgetMeta,
  RecentBudget,
  AccountType,
  Account,
  CategoryGroup,
  Category,
  TransactionType,
  Transaction,
} from "./types";

// Money utilities
export {
  formatMoney,
  formatMoneyCompact,
  getAmountClass,
  centsToEditString,
  parseMoney,
} from "./money";

// Date utilities
export {
  toDateString,
  getToday,
  parseLocalDate,
  formatDateLabel,
  localDateTime,
} from "./date-utils";

// Account-type labels & ordering
export {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
} from "./account-type-labels";

// Default categories
export { DEFAULT_CATEGORIES } from "./default-categories";

// Account operations
export type { AccountFormData } from "./accounts";
export {
  createAccount,
  createOpeningBalanceTransaction,
  isOpeningBalanceTxn,
  updateAccount,
  deleteAccount,
  archiveAccount,
  reorderAccounts,
  unarchiveAccount,
} from "./accounts";

// Category operations
export type { CategoryFormData } from "./categories";
export {
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
} from "./categories";

// Transaction operations
export type { TransactionFormData } from "./transactions";
export {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "./transactions";

// Bulk transaction operations
export {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
} from "./bulk-transactions";

// Merchant categorization
export {
  getUniqueMerchants,
  matchMerchants,
  findCategoryForMerchant,
} from "./merchant";

// Queries
export type { TransferPair } from "./queries";
export {
  CATEGORY_GROUP_ORDER,
  getAccountBalance,
  getAccountsByGroup,
  getTransactionsForAccount,
  getNetWorth,
  resolveTransferPair,
} from "./queries";

// Import types
export type {
  ImportTransaction,
  ImportAliases,
  ImportPhase,
  ImportLogEntry,
} from "./import-types";

// Import account matching
export { matchAccountsByName } from "./import-matching";

// Import merge operations
export type { MergeInput, MergeOutput } from "./import-merge";
export { prepareMerge } from "./import-merge";

// Import validation
export type { ValidationResult } from "./import-validation";
export { validateImportTransactions } from "./import-validation";

// Import duplicate detection
export type { DuplicateConfidence, DuplicateMatch } from "./import-duplicates";
export { detectDuplicates } from "./import-duplicates";

// CSV mapping types
export type {
  CsvMapping,
  AmountMapping,
  SingleAmountMapping,
  SplitAmountMapping,
  AmountFormat,
  TypeDetection,
  SkipRule,
  ColumnRef,
  SingleColumnRef,
  MultiColumnRef,
} from "./csv-mapping";

// CSV transform engine
export type { TransformResult, TransformError } from "./csv-transform";
export { transformCsv, serializeImportCsv, parseCurrencyToCents } from "./csv-transform";
