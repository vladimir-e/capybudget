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
      <div className="flex w-12 flex-col items-center border-r bg-sidebar py-3">
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
          className="mb-2 rounded-md p-2 hover:bg-sidebar-accent"
        >
          <Layers className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-col border-r bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs">Net Worth</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatMoney(netWorth)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setCollapsed(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* All Accounts link */}
          <Link
            to="/budget"
            search={{ path: budgetPath, name: budgetName }}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              !activeAccountId && !isCategoriesRoute
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            }`}
          >
            <Layers className="h-4 w-4" />
            All Accounts
          </Link>

          {/* Account groups */}
          {[...groupedAccounts.entries()].map(([type, accts]) => {
            const groupBalance = accts.reduce(
              (sum, a) => sum + getAccountBalance(a.id, transactions),
              0,
            );

            return (
              <div key={type} className="mt-4">
                <div className="flex items-center justify-between px-3 py-1">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    {ACCOUNT_TYPE_LABELS[type]}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatMoney(groupBalance)}
                  </span>
                </div>

                {accts.map((account) => {
                  const balance = getAccountBalance(account.id, transactions);
                  const isActive = activeAccountId === account.id;

                  return (
                    <Link
                      key={account.id}
                      to="/budget/account/$accountId"
                      params={{ accountId: account.id }}
                      search={{ path: budgetPath, name: budgetName }}
                      className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent"
                      }`}
                    >
                      <span className="truncate">{account.name}</span>
                      <span className="ml-2 shrink-0 tabular-nums text-xs">
                        {formatMoney(balance)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onAddAccount}
        >
          <Plus className="h-4 w-4" />
          Add Account
        </Button>
        <Link
          to="/budget/categories"
          search={{ path: budgetPath, name: budgetName }}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            isCategoriesRoute
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent"
          }`}
        >
          <Settings className="h-4 w-4" />
          Categories
        </Link>
      </div>
    </div>
  );
}
