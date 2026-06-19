import type { ReactNode } from "react";

// Derives the `t()` key space from the English catalogs, so a wrong key fails
// typecheck. Targets i18next (not react-i18next) because `CustomTypeOptions`
// lives there and react-i18next reads its key types from it.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof import("./resources"))["resources"]["en"];
  }
}

// react-i18next's type bundle widens `HTMLAttributes.children` to its own
// `ReactI18NextChildren` (ReactNode plus an object case for the Trans
// component). Under React 19's stricter `ReactNode` that object case is no
// longer assignable, so every child-bearing element trips TS2322. We don't use
// the object-child Trans pattern, so restore the standard React contract.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must mirror React's generic signature to merge
  interface HTMLAttributes<T> {
    children?: ReactNode;
  }
}
