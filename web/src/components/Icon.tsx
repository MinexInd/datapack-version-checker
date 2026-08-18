import type { CSSProperties } from "react";

export type IconName =
  | "folder"
  | "folder-open"
  | "file"
  | "file-text"
  | "search"
  | "map-pin"
  | "pencil"
  | "command"
  | "undo"
  | "diamond"
  | "dot"
  | "x"
  | "check"
  | "x-circle"
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "play"
  | "warning"
  | "arrow-down"
  | "arrow-right"
  | "arrow-up"
  | "gear"
  | "info";

// Icons are stroke-based (OpenCode/Zed / Lucide style). A few are filled glyphs.
const FILLED: IconName[] = ["dot", "play"];

const PATHS: Record<IconName, string> = {
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  "folder-open":
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7a2 2 0 0 0-2 2v6a2 2 0 0 1-2-2V7Z",
  file:
    "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z",
  "file-text":
    "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2ZM9 9h1M9 13h6M9 17h6",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.3-4.3",
  "map-pin":
    "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
  pencil: "M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4",
  command:
    "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0-3 3V9a3 3 0 1 0 3 3h12a3 3 0 1 0 3-3V6a3 3 0 1 0-3 3H6a3 3 0 1 0-3-3",
  undo: "M9 10 4 15l5 5 M20 4v7a4 4 0 0 1-4 4H4",
  diamond: "M12 2 22 12 12 22 2 12Z",
  dot: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  x: "M18 6 6 18 M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  "x-circle":
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M15 9l-6 6 M9 9l6 6",
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-up": "m6 15 6-6 6 6",
  play: "M6 4 20 12 6 20Z",
  warning:
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01",
  "arrow-down": "M12 5v14 M19 12l-7 7-7-7",
  "arrow-right": "M5 12h14 M12 5l7 7-7 7",
  "arrow-up": "M12 19V5 M5 12l7-7 7 7",
  gear:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V19a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V2a2 2 0 0 0-2-2z M11.97 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  info:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 16v-4 M12 8h.01",
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
  style,
  title,
}: IconProps) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      style={{
        display: "inline-block",
        flexShrink: 0,
        verticalAlign: "middle",
        ...style,
      }}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
