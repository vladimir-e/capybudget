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
import type { Account, AccountType } from "@capybudget/core";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER, parseMoney } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useCreateAccount, useUpdateAccount } from "@/hooks/use-account-mutations";
import { toast } from "sonner";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAccount?: Account | null;
}

export function AccountDialog({ open, onOpenChange, editingAccount }: AccountDialogProps) {
  const { t } = useTranslation(["budget", "common"]);
  const { symbol } = useFormatMoney();
  const isEditing = !!editingAccount;
  const [name, setName] = useState(editingAccount?.name ?? "");
  const [type, setType] = useState<AccountType>(editingAccount?.type ?? "checking");
  const [balance, setBalance] = useState("");
  const [nameError, setNameError] = useState(false);
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setName("");
      setType("checking");
      setBalance("");
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
        { id: editingAccount.id, name: name.trim(), type },
        {
          onSuccess: () => {
            toast.success(t("account.toast.updated"));
            handleClose(false);
          },
        },
      );
    } else {
      const openingBalance = balance.trim() ? parseMoney(balance) : 0;
      createAccount.mutate(
        { name: name.trim(), type, openingBalance },
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
                {ACCOUNT_TYPE_ORDER.map((t) => (
                  <ToggleGroupItem
                    key={t}
                    value={t}
                    className="aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand"
                  >
                    {ACCOUNT_TYPE_LABELS[t]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="opening-balance">{t("account.dialog.openingBalance")}</Label>
                <div className="relative">
                  {symbol && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {symbol}
                    </span>
                  )}
                  <Input
                    id="opening-balance"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular-nums ${symbol ? "pl-7" : ""}`}
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
