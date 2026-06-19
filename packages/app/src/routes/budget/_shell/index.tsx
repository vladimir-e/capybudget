import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "@capybudget/i18n";
import { TransactionView } from "@/components/budget/transaction-view";
import { useTransactions } from "@/hooks/use-budget-data";

export const Route = createFileRoute("/budget/_shell/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const { t } = useTranslation("budget");
  const { data: transactions = [] } = useTransactions();

  return (
    <TransactionView
      transactions={transactions}
      showAccountColumn={true}
      header={
        <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
          <h2 className="text-xl font-bold tracking-tight">{t("allAccounts.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("allAccounts.transactionCount", { count: transactions.length })}
          </p>
        </div>
      }
    />
  );
}
