import { MoreHorizontal, Pencil, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-type-labels";
import { getAccountBalance } from "@/lib/queries";
import type { Account, Transaction } from "@/lib/types";
import { toast } from "sonner";

interface AccountHeaderProps {
  account: Account;
  transactions: Transaction[];
}

export function AccountHeader({ account, transactions }: AccountHeaderProps) {
  const balance = getAccountBalance(account.id, transactions);

  return (
    <div className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{account.name}</h2>
            <Badge variant="secondary">{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {formatMoney(balance)}
          </div>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" />}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => toast.info("Edit account — coming in Phase 2")}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.info("Archive account — coming in Phase 2")}>
            <Archive className="mr-2 h-4 w-4" />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => toast.info("Delete account — coming in Phase 2")}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
