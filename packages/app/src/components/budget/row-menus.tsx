import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Account, Transaction } from "@capybudget/core";
import type { TFunction } from "i18next";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";

type RowMenuT = TFunction<["budget", "common"]>;

export function transactionMenuItems(
  txn: Transaction,
  {
    onEdit,
    onDelete,
  }: {
    onEdit?: (transaction: Transaction) => void;
    onDelete?: (transaction: Transaction) => void;
  },
  t: RowMenuT,
) {
  return (
    <>
      {onEdit && (
        <DropdownMenuItem onClick={() => onEdit(txn)}>
          <Pencil className="h-3.5 w-3.5" />
          {t("common:actions.edit")}
        </DropdownMenuItem>
      )}
      {onDelete && (
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(txn)}>
          <Trash2 className="h-3.5 w-3.5" />
          {t("common:actions.delete")}
        </DropdownMenuItem>
      )}
    </>
  );
}

export function accountMenuItems(
  account: Account,
  {
    onEdit,
    onArchive,
    onDelete,
  }: {
    onEdit: (account: Account) => void;
    onArchive: (account: Account) => void;
    onDelete: (account: Account) => void;
  },
  t: RowMenuT,
) {
  return (
    <>
      <DropdownMenuItem onClick={() => onEdit(account)}>
        <Pencil className="mr-2 h-4 w-4" />
        {t("common:actions.edit")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onArchive(account)}>
        {account.archived ? (
          <ArchiveRestore className="mr-2 h-4 w-4" />
        ) : (
          <Archive className="mr-2 h-4 w-4" />
        )}
        {account.archived ? t("common:actions.unarchive") : t("common:actions.archive")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(account)}>
        <Trash2 className="mr-2 h-4 w-4" />
        {t("common:actions.delete")}
      </DropdownMenuItem>
    </>
  );
}

export function categoryMenuItems(
  {
    isArchived,
    onStartRename,
    onArchive,
    onDelete,
  }: {
    isArchived: boolean;
    onStartRename: () => void;
    onArchive: () => void;
    onDelete: () => void;
  },
  t: RowMenuT,
) {
  return (
    <>
      {!isArchived && (
        <DropdownMenuItem onClick={onStartRename}>
          {t("category.menu.rename")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onArchive}>
        {isArchived ? t("common:actions.unarchive") : t("common:actions.archive")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 className="mr-2 h-4 w-4" />
        {t("common:actions.delete")}
      </DropdownMenuItem>
    </>
  );
}
