import { Link, useMatches } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, GripVertical, Layers, MoreHorizontal, Archive, ArchiveRestore, Trash2, Plus, Settings } from "lucide-react";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-type-labels";
import { getAccountBalance, getAccountsByGroup, getNetWorth } from "@/lib/queries";
import { useAccounts, useTransactions } from "@/hooks/use-budget-data";
import {
  useDeleteAccount,
  useArchiveAccount,
  useUnarchiveAccount,
} from "@/hooks/use-account-mutations";
import type { Account, AccountType } from "@/lib/types";
import { toast } from "sonner";

interface SidebarProps {
  budgetPath: string;
  budgetName: string;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onAddAccount: () => void;
  onReorderAccounts: (type: AccountType, orderedIds: string[]) => void;
}

export function Sidebar({
  budgetPath,
  budgetName,
  collapsed,
  onCollapse,
  onAddAccount,
  onReorderAccounts,
}: SidebarProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const deleteAccount = useDeleteAccount();
  const archiveAccount = useArchiveAccount();
  const unarchiveAccount = useUnarchiveAccount();
  const [showArchived, setShowArchived] = useState(false);
  const matches = useMatches();
  const activeAccountId = matches.reduce<string | undefined>((found, m) => {
    const params = m.params as Record<string, unknown>;
    return found ?? (params.accountId as string | undefined);
  }, undefined);
  const isCategoriesRoute = matches.some((m) => m.routeId?.includes("/categories"));

  const netWorth = getNetWorth(accounts, transactions);
  const groupedAccounts = getAccountsByGroup(accounts);
  const archivedAccounts = accounts.filter((a) => a.archived);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    for (const [type, accts] of groupedAccounts) {
      const ids = accts.map((a) => a.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...ids];
        reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, active.id as string);
        onReorderAccounts(type, reordered);
        break;
      }
    }
  }

  function handleArchive(account: Account) {
    if (account.archived) {
      unarchiveAccount.mutate(account.id, {
        onSuccess: () => toast.success(`${account.name} unarchived`),
        onError: (err) => toast.error(err.message),
      });
    } else {
      archiveAccount.mutate(account.id, {
        onSuccess: () => toast.success(`${account.name} archived`),
        onError: (err) => toast.error(err.message),
      });
    }
  }

  function handleDelete(account: Account) {
    deleteAccount.mutate(account.id, {
      onSuccess: () => toast.success(`${account.name} deleted`),
      onError: (err) => toast.error(err.message),
    });
  }

  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
        <Button
          variant="ghost"
          size="icon"
          className="mb-4 h-8 w-8"
          onClick={() => onCollapse(false)}
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
    <div className="relative flex w-72 flex-col border-r border-sidebar-border bg-sidebar">
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
      </div>

      <ScrollArea className="flex-1 min-h-0">
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

          {/* Account groups — sortable */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            {[...groupedAccounts.entries()].map(([type, accts]) => {
              const showGroupTotal = accts.length > 1;
              const groupBalance = showGroupTotal
                ? accts.reduce(
                    (sum, a) => sum + getAccountBalance(a.id, transactions),
                    0,
                  )
                : 0;

              return (
                <div key={type} className="mt-5">
                  <div className="flex items-center justify-between pl-3 pr-9 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {ACCOUNT_TYPE_LABELS[type]}
                    </span>
                    {showGroupTotal && (
                      <span className="text-[11px] font-medium tabular-nums text-muted-foreground/60">
                        {formatMoney(groupBalance)}
                      </span>
                    )}
                  </div>

                  <SortableContext
                    items={accts.map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-0.5">
                      {accts.map((account) => (
                        <SortableAccountRow
                          key={account.id}
                          account={account}
                          balance={getAccountBalance(account.id, transactions)}
                          budgetPath={budgetPath}
                          budgetName={budgetName}
                          isActive={activeAccountId === account.id}
                          onArchive={handleArchive}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </div>
              );
            })}
          </DndContext>

          {/* Archived accounts */}
          {archivedAccounts.length > 0 && (
            <div className="mt-5">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="flex items-center gap-1.5 px-3 mb-1 w-full text-left"
              >
                <ChevronDown className={`h-3 w-3 text-muted-foreground/50 transition-transform ${showArchived ? "" : "-rotate-90"}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  Archived
                </span>
                <span className="text-[11px] text-muted-foreground/40 ml-auto">
                  {archivedAccounts.length}
                </span>
              </button>

              {showArchived && (
                <div className="space-y-0.5">
                  {archivedAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      balance={getAccountBalance(account.id, transactions)}
                      budgetPath={budgetPath}
                      budgetName={budgetName}
                      isActive={activeAccountId === account.id}
                      dimmed
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
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

// ── Account Row Components ──────────────────────────────────

interface AccountRowProps {
  account: Account;
  balance: number;
  budgetPath: string;
  budgetName: string;
  isActive: boolean;
  dimmed?: boolean;
  onArchive: (account: Account) => void;
  onDelete: (account: Account) => void;
}

function SortableAccountRow(props: AccountRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.account.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AccountRow {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function AccountRow({
  account,
  balance,
  budgetPath,
  budgetName,
  isActive,
  dimmed,
  onArchive,
  onDelete,
  dragHandleProps,
}: AccountRowProps & {
  dragHandleProps?: Record<string, unknown>;
}) {
  return (
    <div className={`flex items-center rounded-lg transition-all ${
      isActive
        ? "bg-sidebar-accent shadow-sm"
        : dimmed
          ? "hover:bg-sidebar-accent/40"
          : "hover:bg-sidebar-accent/60"
    }`}>
      {dragHandleProps && (
        <button
          className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing ml-1 touch-none"
          {...dragHandleProps}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}

      <Link
        to="/budget/account/$accountId"
        params={{ accountId: account.id }}
        search={{ path: budgetPath, name: budgetName }}
        className={`flex flex-1 min-w-0 items-center justify-between py-1.5 text-sm ${
          dragHandleProps ? "pl-0.5 pr-3" : "px-3"
        } ${
          isActive
            ? "text-sidebar-accent-foreground font-medium"
            : dimmed
              ? "text-sidebar-foreground/40 hover:text-sidebar-foreground/60"
              : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
        }`}
      >
        <span className="truncate">{account.name}</span>
        <span className={`ml-2 shrink-0 tabular-nums text-xs font-medium ${
          balance < 0 ? "text-amount-expense/80" : balance > 0 ? "text-amount-income/80" : ""
        } ${dimmed ? "opacity-50" : ""}`}>
          {formatMoney(balance)}
        </span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground mr-1" />
          }
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" sideOffset={4}>
          <DropdownMenuItem onClick={() => onArchive(account)}>
            {account.archived ? (
              <ArchiveRestore className="mr-2 h-4 w-4" />
            ) : (
              <Archive className="mr-2 h-4 w-4" />
            )}
            {account.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(account)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
