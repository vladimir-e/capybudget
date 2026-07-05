import { toast as sonnerToast } from "sonner";

// Error toasts persist until dismissed so a failure can't flash by unnoticed;
// every other kind keeps sonner's default auto-dismiss. Per-call options still
// win — the spread lets a caller pass a finite `duration` to opt back out.
const error: typeof sonnerToast.error = (message, data) =>
  sonnerToast.error(message, { duration: Infinity, ...data });

export const toast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  { error },
);
