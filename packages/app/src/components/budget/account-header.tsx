import { Badge } from "@/components/ui/badge";
import type { Account } from "@capybudget/core";
import { formatMoney, ACCOUNT_TYPE_LABELS } from "@capybudget/core";

interface AccountHeaderProps {
  account: Account;
  balance: number;
}

export function AccountHeader({ account, balance }: AccountHeaderProps) {
  return (
    <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold tracking-tight">{account.name}</h2>
        <Badge variant="outline" className="text-brand border-brand/25 bg-brand-subtle/50 font-medium">
          {ACCOUNT_TYPE_LABELS[account.type]}
        </Badge>
      </div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${
        balance < 0 ? "text-amount-expense" : "text-foreground"
      }`}>
        {formatMoney(balance)}
      </div>
    </div>
  );
}
