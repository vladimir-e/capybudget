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
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import type { AccountType } from "@/lib/types";
import { parseMoney } from "@/lib/money";
import { useCreateAccount } from "@/hooks/use-account-mutations";
import { toast } from "sonner";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddAccountDialog({ open, onOpenChange }: AddAccountDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [balance, setBalance] = useState("");
  const createAccount = useCreateAccount();

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setName("");
      setType("checking");
      setBalance("");
    }
    onOpenChange(nextOpen);
  }

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Account name is required");
      return;
    }
    const openingBalance = balance.trim() ? parseMoney(balance) : 0;
    createAccount.mutate(
      { name: name.trim(), type, openingBalance },
      {
        onSuccess: () => {
          toast.success("Account created");
          handleClose(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                placeholder="e.g. BofA Checking"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
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

            <div className="space-y-2">
              <Label htmlFor="opening-balance">Opening Balance</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="opening-balance"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-7 tabular-nums"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Create Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
