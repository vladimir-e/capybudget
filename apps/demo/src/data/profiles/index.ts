import type { DemoProfile } from "./types";
import { underwater } from "./underwater";
import { paycheckToPaycheck } from "./paycheck-to-paycheck";
import { noStress } from "./no-stress";

export type {
  Cadence,
  DemoProfile,
  FixedBill,
  IncomeStream,
  OccasionalExpense,
  TransferStream,
  VariableBill,
  VariableExpense,
} from "./types";

export const PROFILES: Record<string, DemoProfile> = {
  [underwater.id]: underwater,
  [paycheckToPaycheck.id]: paycheckToPaycheck,
  [noStress.id]: noStress,
};

export const PROFILE_LIST: DemoProfile[] = [
  underwater,
  paycheckToPaycheck,
  noStress,
];
