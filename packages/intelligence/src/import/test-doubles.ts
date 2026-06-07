/**
 * Headless test doubles for the import orchestrator — an in-memory staging
 * store, a fixed budget-data provider, and a scriptable structured session.
 * Export-only (not a `.test.ts`) so every import test shares one set, per
 * STRUCTURE.md's test-factory rule.
 */

import type { Account, Category, ImportTransaction, RowContext, Transaction } from "@capybudget/core";
import type { JsonSchema, StructuredMessage, StructuredSession } from "../structured";
import type { BudgetDataProvider } from "./budget-data";
import type { ImportState, SourceFile, StagingStore } from "./staging-store";

/** An in-memory {@link StagingStore} — the resume substrate without a disk. */
export class MemoryStagingStore implements StagingStore {
  sources: SourceFile[] = [];
  transactions: ImportTransaction[] | null = null;
  context: Record<string, RowContext> | null = null;
  state: ImportState | null = null;
  /** How many times transactions were written — asserts per-batch persistence. */
  writeCount = 0;

  constructor(init: Partial<Pick<MemoryStagingStore, "sources" | "transactions" | "context" | "state">> = {}) {
    if (init.sources) this.sources = init.sources;
    if (init.transactions) this.transactions = init.transactions;
    if (init.context) this.context = init.context;
    if (init.state) this.state = init.state;
  }

  async listSources(): Promise<SourceFile[]> {
    return this.sources;
  }
  async readTransactions(): Promise<ImportTransaction[] | null> {
    return this.transactions ? this.transactions.map((r) => ({ ...r })) : null;
  }
  async writeTransactions(rows: ImportTransaction[]): Promise<void> {
    this.transactions = rows.map((r) => ({ ...r }));
    this.writeCount++;
  }
  async readContext(): Promise<Record<string, RowContext> | null> {
    return this.context;
  }
  async writeContext(context: Record<string, RowContext>): Promise<void> {
    this.context = context;
  }
  async readState(): Promise<ImportState | null> {
    return this.state;
  }
  async writeState(state: ImportState): Promise<void> {
    this.state = state;
  }
  async clear(): Promise<void> {
    this.transactions = null;
    this.context = null;
    this.state = null;
    this.sources = [];
  }
}

/** A fixed-snapshot {@link BudgetDataProvider}. */
export class MemoryBudgetData implements BudgetDataProvider {
  constructor(
    private readonly history: Transaction[] = [],
    private readonly categories: Category[] = [],
    private readonly accounts: Account[] = [],
  ) {}
  async getHistory(): Promise<Transaction[]> {
    return this.history;
  }
  async getCategories(): Promise<Category[]> {
    return this.categories;
  }
  async getAccounts(): Promise<Account[]> {
    return this.accounts;
  }
}

/**
 * A scriptable {@link StructuredSession}. Each call pops the next responder,
 * which returns a value (sync or via a promise) or throws / returns an `Error`
 * (to exercise batch-failure isolation). An async responder lets a test gate a
 * batch's completion to drive in-flight ordering (the cancel race). Records
 * every call for assertions; runs out → throws so an over-call is loud.
 */
export class MockStructuredSession implements StructuredSession {
  readonly calls: { messages: readonly StructuredMessage[]; schema: JsonSchema }[] = [];
  private readonly responders: ((messages: readonly StructuredMessage[]) => unknown)[];

  constructor(responders: ((messages: readonly StructuredMessage[]) => unknown)[]) {
    this.responders = responders;
  }

  async structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
  ): Promise<T> {
    this.calls.push({ messages, schema });
    const responder = this.responders.shift();
    if (!responder) throw new Error("MockStructuredSession: no responder left for call");
    const value = await responder(messages);
    if (value instanceof Error) throw value;
    return value as T;
  }
}
