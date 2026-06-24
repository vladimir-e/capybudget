import { Badge } from "@/components/ui/badge";
import { AddTransactionButton } from "@/components/budget/add-transaction-button";
import type { Account } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatters } from "@/hooks/use-formatters";
import { useAccountMoney, useCurrency } from "@/contexts/currency-context";
import { useAccountTypeLabel } from "@/lib/display-names";

interface AccountHeaderProps {
  account: Account;
  /** Balance in the account's own currency — the headline figure. */
  nativeBalance: number;
  /** The same balance valued in the budget default at today's rate, for the
   *  secondary line a foreign account shows. */
  defaultBalance: number;
}

export function AccountHeader({ account, nativeBalance, defaultBalance }: AccountHeaderProps) {
  const { t } = useTranslation("budget");
  const { money } = useFormatters();
  const accountMoney = useAccountMoney();
  const defaultCurrency = useCurrency();
  const accountTypeLabel = useAccountTypeLabel();
  const isForeign = account.currency !== defaultCurrency;
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight">{account.name}</h2>
          <Badge variant="outline" className="text-brand border-brand/25 bg-brand-subtle/50 font-medium">
            {accountTypeLabel(account.type)}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-3xl font-bold tabular-nums ${
            nativeBalance < 0 ? "text-amount-expense" : "text-foreground"
          }`}>
            {accountMoney(nativeBalance, account.currency)}
          </span>
          {isForeign && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("account.header.inDefault", { amount: money(defaultBalance) })}
            </span>
          )}
        </div>
      </div>
      {!account.archived && <AddTransactionButton />}
    </div>
  );
}
