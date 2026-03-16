import type { DemoPreset } from "./helpers";
import { underwater } from "./underwater";
import { paycheckToPaycheck } from "./paycheck-to-paycheck";
import { noStress } from "./no-stress";

export type { DemoPreset } from "./helpers";

export const PRESETS: Record<string, DemoPreset> = {
  [underwater.id]: underwater,
  [paycheckToPaycheck.id]: paycheckToPaycheck,
  [noStress.id]: noStress,
};

export const PRESET_LIST: DemoPreset[] = [underwater, paycheckToPaycheck, noStress];
