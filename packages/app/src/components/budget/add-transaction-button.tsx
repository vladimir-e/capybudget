import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBudgetUI } from "@/contexts/budget-context";
import { useTranslation } from "@capybudget/i18n";

export function AddTransactionButton({ className }: { className?: string }) {
  const { t } = useTranslation("budget");
  const { startTransaction } = useBudgetUI();
  return (
    <Button onClick={startTransaction} className={className}>
      <Plus />
      {t("shell.addTransaction")}
    </Button>
  );
}
