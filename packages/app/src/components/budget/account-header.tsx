import { Badge } from "@/components/ui/badge";
import type { Account } from "@capybudget/core";
import { useFormatMoney } from "@/contexts/currency-context";
import { useAccountTypeLabel } from "@/lib/display-names";

interface AccountHeaderProps {
  account: Account;
  balance: number;
}

export function AccountHeader({ account, balance }: AccountHeaderProps) {
  const { format } = useFormatMoney();
  const accountTypeLabel = useAccountTypeLabel();
  return (
    <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold tracking-tight">{account.name}</h2>
        <Badge variant="outline" className="text-brand border-brand/25 bg-brand-subtle/50 font-medium">
          {accountTypeLabel(account.type)}
        </Badge>
      </div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${
        balance < 0 ? "text-amount-expense" : "text-foreground"
      }`}>
        {format(balance)}
      </div>
    </div>
  );
}
