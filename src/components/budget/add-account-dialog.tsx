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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import { toast } from "sonner";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddAccountDialog({ open, onOpenChange }: AddAccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" placeholder="e.g. BofA Checking" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-type">Type</Label>
            <Select>
              <SelectTrigger id="account-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPE_ORDER.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ACCOUNT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              toast.info("Account creation — coming in Phase 2");
              onOpenChange(false);
            }}
          >
            Create Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
