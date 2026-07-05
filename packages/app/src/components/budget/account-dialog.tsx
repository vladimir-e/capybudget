import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CurrencyCombobox } from "@/components/budget/currency-combobox";
import type { Account, AccountType } from "@capybudget/core";
import { ACCOUNT_TYPE_ORDER, parseMoney, currencySymbol } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useSearch } from "@tanstack/react-router";
import { useAccountTypeLabel } from "@/lib/display-names";
import { useCurrency } from "@/contexts/currency-context";
import { useTransactions } from "@/hooks/use-budget-data";
import { useCreateAccount, useUpdateAccount } from "@/hooks/use-account-mutations";
import { toast } from "@/lib/toast";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAccount?: Account | null;
}

export function AccountDialog({ open, onOpenChange, editingAccount }: AccountDialogProps) {
  const { t } = useTranslation(["budget", "common"]);
  const { path } = useSearch({ from: "/budget" });
  const accountTypeLabel = useAccountTypeLabel();
  const defaultCurrency = useCurrency();
  const { data: transactions = [], isSuccess: transactionsLoaded } = useTransactions();
  const isEditing = !!editingAccount;
  const [name, setName] = useState(editingAccount?.name ?? "");
  const [type, setType] = useState<AccountType>(editingAccount?.type ?? "checking");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState(editingAccount?.currency ?? defaultCurrency);
  const [nameError, setNameError] = useState(false);
  const createAccount = useCreateAccount(path);
  const updateAccount = useUpdateAccount();

  // Currency locks once the account carries any transaction — an opening
  // balance counts. Changing it under historical amounts is meaningless, so the
  // honest move is a new account. Core enforces this authoritatively; the lock
  // here is UX only, so it must stay conservative: until the transaction list has
  // actually loaded, keep an edited account locked rather than offering a change
  // that a cold cache would let through and core would then reject.
  const currencyLocked =
    isEditing &&
    (!transactionsLoaded || transactions.some((tx) => tx.accountId === editingAccount.id));
  const balanceSymbol = currencySymbol(currency);

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setName("");
      setType("checking");
      setBalance("");
      setCurrency(defaultCurrency);
      setNameError(false);
    }
    onOpenChange(nextOpen);
  }

  function handleSubmit() {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    if (isEditing) {
      updateAccount.mutate(
        { id: editingAccount.id, name: name.trim(), type, currency },
        {
          onSuccess: () => {
            toast.success(t("account.toast.updated"));
            handleClose(false);
          },
          onError: (error) => {
            // Core rejects a currency change on an account with transactions; a
            // stale UI that slipped past the lock surfaces the thrown reason here
            // instead of failing silently.
            toast.error(error instanceof Error ? error.message : String(error));
          },
        },
      );
    } else {
      const openingBalance = balance.trim() ? parseMoney(balance) : 0;
      createAccount.mutate(
        { name: name.trim(), type, openingBalance, currency },
        {
          onSuccess: () => {
            toast.success(t("account.toast.created"));
            handleClose(false);
          },
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <DialogHeader>
            <DialogTitle>{isEditing ? t("account.dialog.editTitle") : t("account.dialog.addTitle")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">{t("account.dialog.name")}</Label>
              <Input
                id="account-name"
                placeholder={t("account.dialog.namePlaceholder")}
                value={name}
                onChange={(e) => { setName(e.target.value); setNameError(false); }}
                aria-invalid={nameError}
              />
              {nameError && (
                <p className="text-xs text-destructive">{t("account.dialog.nameRequired")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("account.dialog.type")}</Label>
              <ToggleGroup
                variant="outline"
                spacing={2}
                className="flex-wrap"
                value={[type]}
                onValueChange={(v) => { if (v.length > 0) setType(v[v.length - 1] as AccountType); }}
              >
                {ACCOUNT_TYPE_ORDER.map((type) => (
                  <ToggleGroupItem
                    key={type}
                    value={type}
                    className="aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand"
                  >
                    {accountTypeLabel(type)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-currency">{t("account.dialog.currency")}</Label>
              <CurrencyCombobox
                id="account-currency"
                value={currency}
                onChange={setCurrency}
                disabled={currencyLocked}
              />
              {currencyLocked && (
                <p className="text-xs text-muted-foreground">
                  {t("account.dialog.currencyLocked")}
                </p>
              )}
            </div>

            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="opening-balance">{t("account.dialog.openingBalance")}</Label>
                <div className="relative">
                  {balanceSymbol && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {balanceSymbol}
                    </span>
                  )}
                  <Input
                    id="opening-balance"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular-nums ${balanceSymbol ? "pl-7" : ""}`}
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit">
              {isEditing ? t("common:actions.save") : t("account.dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
