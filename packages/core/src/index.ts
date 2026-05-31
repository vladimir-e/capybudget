// Types
export type {
  BudgetMeta,
  BudgetBasis,
  RecentBudget,
  AccountType,
  Account,
  CategoryGroup,
  Category,
  TransactionType,
  Transaction,
} from "./entities/types";
export { BUDGET_BASES, BASIS_OPTION_LABELS } from "./entities/types";

// Money utilities
export {
  formatMoney,
  formatMoneyCompact,
  getAmountClass,
  centsToEditString,
  parseMoney,
} from "./utils/money";

// Date utilities
export {
  toDateString,
  getToday,
  parseLocalDate,
  formatDateLabel,
  localDateTime,
} from "./utils/date-utils";

// Account-type labels & ordering
export {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
} from "./constants/account-type-labels";

// Default categories
export { DEFAULT_CATEGORIES } from "./constants/default-categories";

// Account operations
export type { AccountFormData } from "./entities/accounts";
export {
  createAccount,
  createOpeningBalanceTransaction,
  isOpeningBalanceTxn,
  updateAccount,
  deleteAccount,
  archiveAccount,
  reorderAccounts,
  unarchiveAccount,
  setNetWorthExclusions,
} from "./entities/accounts";

// Category operations
export type { CategoryFormData } from "./entities/categories";
export {
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
  setCategoryAssigned,
} from "./entities/categories";

// Transaction operations
export type { TransactionFormData } from "./entities/transactions";
export {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "./entities/transactions";

// Bulk transaction operations
export {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
} from "./entities/bulk-transactions";

// Merchant categorization
export {
  getUniqueMerchants,
  matchMerchants,
  findCategoryForMerchant,
} from "./utils/merchant";

// Queries
export type { TransferPair } from "./analytics/queries";
export {
  CATEGORY_GROUP_ORDER,
  getAccountBalance,
  getAccountsByGroup,
  getTransactionsForAccount,
  getNetWorth,
  resolveTransferPair,
} from "./analytics/queries";

// Import types
export type {
  ImportTransaction,
  ImportAliases,
  ImportPhase,
  ImportLogEntry,
} from "./import/import-types";

// Import account matching
export { matchAccountsByName } from "./import/import-matching";

// Import merge operations
export type { MergeInput, MergeOutput } from "./import/import-merge";
export { prepareMerge } from "./import/import-merge";

// Import validation
export type { ValidationResult } from "./import/import-validation";
export { validateImportTransactions } from "./import/import-validation";

// Import duplicate detection
export type { DuplicateConfidence, DuplicateMatch } from "./import/import-duplicates";
export { detectDuplicates } from "./import/import-duplicates";

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
} from "./import/csv-mapping";

// CSV transform engine
export type { TransformResult, TransformError } from "./import/csv-transform";
export { transformCsv, serializeImportCsv, parseCurrencyToCents } from "./import/csv-transform";

// Analytics
export type {
  DateRange,
  CategoryBreakdown,
  NetWorthPoint,
  CashFlowPoint,
  MerchantSpending,
  TrendPoint,
  TrendSeries,
  CategoryTrendsResult,
  CategoryMonthSummary,
  MonthlyBudgetSummary,
  CategoryHistoricalStats,
  CategoryHistoricalStatsResult,
} from "./analytics/analytics";
export {
  ensureMinMonths,
  filterTransactionsByDateRange,
  getSpendingByCategory,
  getIncomeByCategory,
  getNetWorthOverTime,
  getPeriodSummary,
  getCashFlow,
  getTopMerchants,
  getCategoryTrends,
  getMonthlyBudgetSummary,
  getCategoryHistoricalStats,
  basisMonths,
  basisLabel,
} from "./analytics/analytics";
