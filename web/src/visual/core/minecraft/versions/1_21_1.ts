import { VersionData } from "../types";
import { V1_21 } from "./1_21";

// Minecraft Java Edition 1.21.1.
// Shares the 1.21 command/registry knowledge (pack format 48; no syntax-affecting
// changes between 1.21 and 1.21.1 for the supported feature set). Kept as a
// separate entry so the version layer is genuinely data-driven and per-patch
// overrides can be added here without touching the shared base.
export const V1_21_1: VersionData = {
  ...V1_21,
  version: "1.21.1",
  label: "1.21.1",
  packFormat: 48,
  changes: [
    ...V1_21.changes,
    {
      version: "1.21.1",
      title: "Bug-fix release",
      description: "1.21.1 is a bug-fix release. Command surface is identical to 1.21 for the supported feature set.",
    },
  ],
};
