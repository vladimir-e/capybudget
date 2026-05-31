import { useMemo, useState, type ReactNode } from "react";
import { useCapySession, type UseCapySessionOptions } from "@/hooks/use-capy-session";
import {
  CapySessionContext,
  type CapySessionContextValue,
} from "@/contexts/capy-session-context";

export function CapySessionProvider({
  options,
  children,
}: {
  options: UseCapySessionOptions;
  children: ReactNode;
}) {
  const session = useCapySession(options);
  const [open, setOpen] = useState(false);

  const value = useMemo<CapySessionContextValue>(
    () => ({ ...session, open, setOpen }),
    [session, open],
  );

  return <CapySessionContext.Provider value={value}>{children}</CapySessionContext.Provider>;
}
