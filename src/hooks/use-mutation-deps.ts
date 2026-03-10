import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { useUndoRedo } from "@/hooks/use-undo-redo";

export function useMutationDeps() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return { queryClient, repo, captureSnapshot };
}
