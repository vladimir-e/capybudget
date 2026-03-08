import { Link, useMatches } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Layers, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import { getAccountBalance, getNetWorth } from "@/lib/queries";
import type { Account, AccountType, Transaction } from "@/lib/types";

interface SidebarProps {
  accounts: Account[];
  transactions: Transaction[];
  budgetPath: string;
  budgetName: string;
  onAddAccount: () => void;
}

export function Sidebar({
  accounts,
  transactions,
  budgetPath,
  budgetName,
  onAddAccount,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const matches = useMatches();
  const activeAccountId = matches.reduce<string | undefined>((found, m) => {
    const params = m.params as Record<string, unknown>;
    return found ?? (params.accountId as string | undefined);
  }, undefined);
  const isCategoriesRoute = matches.some((m) => m.routeId?.includes("/categories"));

  const netWorth = getNetWorth(accounts, transactions);

  // Group non-archived accounts by type
  const groupedAccounts = new Map<AccountType, Account[]>();
  for (const type of ACCOUNT_TYPE_ORDER) {
    const matching = accounts
      .filter((a) => a.type === type && !a.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (matching.length > 0) {
      groupedAccounts.set(type, matching);
    }
  }

  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
        <Button
          variant="ghost"
          size="icon"
          className="mb-4 h-8 w-8"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Link
          to="/budget"
          search={{ path: budgetPath, name: budgetName }}
          className="mb-2 rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Layers className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Net Worth — warm hero area */}
      <div className="px-4 pt-4 pb-3">
        <div className="rounded-lg bg-brand-subtle px-3 py-3">
          <div className="text-xs font-medium text-brand/70 uppercase tracking-wider">
            Net Worth
          </div>
          <div className="text-2xl font-bold tabular-nums text-brand mt-0.5">
            {formatMoney(netWorth)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-14 h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed(true)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
          {/* All Accounts link */}
          <Link
            to="/budget"
            search={{ path: budgetPath, name: budgetName }}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              !activeAccountId && !isCategoriesRoute
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            }`}
          >
            <Layers className="h-4 w-4 text-brand" />
            All Accounts
          </Link>

          {/* Account groups */}
          {[...groupedAccounts.entries()].map(([type, accts]) => {
            const groupBalance = accts.reduce(
              (sum, a) => sum + getAccountBalance(a.id, transactions),
              0,
            );

            return (
              <div key={type} className="mt-5">
                <div className="flex items-center justify-between px-3 mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {ACCOUNT_TYPE_LABELS[type]}
                  </span>
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground/60">
                    {formatMoney(groupBalance)}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {accts.map((account) => {
                    const balance = getAccountBalance(account.id, transactions);
                    const isActive = activeAccountId === account.id;

                    return (
                      <Link
                        key={account.id}
                        to="/budget/account/$accountId"
                        params={{ accountId: account.id }}
                        search={{ path: budgetPath, name: budgetName }}
                        className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-all ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm font-medium"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        }`}
                      >
                        <span className="truncate">{account.name}</span>
                        <span className={`ml-2 shrink-0 tabular-nums text-xs font-medium ${
                          balance < 0 ? "text-amount-expense/80" : ""
                        }`}>
                          {formatMoney(balance)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
          onClick={onAddAccount}
        >
          <Plus className="h-4 w-4" />
          Add Account
        </Button>
        <Link
          to="/budget/categories"
          search={{ path: budgetPath, name: budgetName }}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            isCategoriesRoute
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm font-medium"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          }`}
        >
          <Settings className="h-4 w-4" />
          Categories
        </Link>
      </div>
    </div>
  );
}
