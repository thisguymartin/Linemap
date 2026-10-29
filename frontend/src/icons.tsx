import type { ReactElement } from 'react';

// One icon system: 16px grid, 1.5px stroke, round joins. Authored, not emoji.
const PATHS: Record<string, ReactElement> = {
  save: <><path d="M5 2.5h6.5L13.5 5v8.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" /><path d="M5.5 2.5v4h5v-4M5.5 14.5v-4.5h5v4.5" /></>,
  check: <path d="M3 8.5l3 3 7-7" />,
  restore: <><path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" /><path d="M3 2.5v3h3" /></>,
  trash: <><path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.6 9h5.8l.6-9" /></>,
  panel: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M10 3v10" /></>,
  sun: <><circle cx="8" cy="8" r="2.75" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></>,
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />,
  map: <><path d="M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" /><path d="M5.5 2v10.5M10.5 3.5V14" /></>,
  list: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  plus: <path d="M8 3v10M3 8h10" />,
  send: <path d="M14 2L7.5 8.5M14 2L9.5 14l-2-5.5L2 6.5z" />,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8" /><path d="M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8" /></>,
  tag: <><path d="M2 2.5h5.5L14 9l-5 5-6.5-6.5z" /><circle cx="5.25" cy="5.75" r="1" /></>,
  chevron: <path d="M6 3.5L10.5 8 6 12.5" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  bot: <><rect x="2.5" y="5" width="11" height="8" rx="2" /><path d="M8 2.5V5M6 9h.01M10 9h.01" /><path d="M5.5 11.5h5" /></>,
  user: <><circle cx="8" cy="5.5" r="2.75" /><path d="M2.5 14a5.5 5.5 0 0 1 11 0" /></>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>,
  locate: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" /></>,
  arrow: <path d="M2.5 8h11M9.5 4l4 4-4 4" />,
  edit: <><path d="M10.5 2.5l3 3-8 8h-3v-3z" /><path d="M9 4l3 3" /></>,
  inbox: <><path d="M2.5 9.5h3l1 2h3l1-2h3" /><path d="M4 3.5h8l1.5 6v4h-11v-4z" /></>,
  reopen: <><path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2" /><path d="M13 2.5v3h-3" /></>,
  folder: <path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  branch: <><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 2.5-2 3-5.5 3.5" /></>,
  up: <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />,
  home: <><path d="M2.5 7.5L8 3l5.5 4.5" /><path d="M4 6.5V13h8V6.5" /></>,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" />,
  chat: <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />,
  terminal: <><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M4.5 6l2 2-2 2M8.5 10.5h3" /></>,
  search: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>,
  sparkle: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M4 12l1.8-1.8M10.2 5.8L12 4" />,
  train: <><rect x="3" y="2.5" width="10" height="9" rx="2" /><path d="M3 7.5h10M6 14l-1 1.5M10 14l1 1.5M5.5 11.5h5" /><circle cx="6" cy="9.5" r=".6" /><circle cx="10" cy="9.5" r=".6" /></>
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): ReactElement {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
