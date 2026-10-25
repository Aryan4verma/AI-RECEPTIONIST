/**
 * Coherent inline icon vocabulary — 1.75 stroke, round caps, 24-grid.
 * Icons are aria-hidden; interactive controls name them via label/aria-label.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
    <path d="M8.5 11h7M8.5 14.5h4" />
  </Svg>
);

export const IconPhone = (p: P) => (
  <Svg {...p}>
    <path d="M6.8 3h2.1l1.7 4.3-2 1.4a12.5 12.5 0 0 0 5.7 5.7l1.4-2 4.3 1.7v2.1a2.8 2.8 0 0 1-3 2.8A16.5 16.5 0 0 1 4 6a2.8 2.8 0 0 1 2.8-3Z" />
  </Svg>
);

export const IconPhoneOff = (p: P) => (
  <Svg {...p}>
    <path d="M6.8 3h2.1l1.7 4.3-2 1.4a12.5 12.5 0 0 0 5.7 5.7l1.4-2 4.3 1.7v2.1a2.8 2.8 0 0 1-3 2.8A16.5 16.5 0 0 1 4 6a2.8 2.8 0 0 1 2.8-3Z" />
    <path d="m3 3 18 18" />
  </Svg>
);

export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const IconMicOff = (p: P) => (
  <Svg {...p}>
    <path d="M9 6a3 3 0 0 1 6 0v5m-6 .2A3 3 0 0 0 12 14a3 3 0 0 0 3-3" />
    <path d="M5 11a7 7 0 0 0 11.1 5.7M19 11v.5M12 18v3" />
    <path d="m3 3 18 18" />
  </Svg>
);

export const IconSpeaker = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
  </Svg>
);

export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.4a6.5 6.5 0 0 1 4 5.6" />
  </Svg>
);

export const IconMessages = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-5 4V7a2 2 0 0 1 2-2Z" />
    <path d="M21 9v6a4 4 0 0 1-4 4h-8" />
  </Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5 13.7 5h2.9l1 2.7 2.6 1.3-.6 3 1.7 2.4-1.7 2.4.6 3-2.6 1.3-1 2.7h-2.9L12 21.5 10.3 19H7.4l-1-2.7L3.8 15l.6-3-1.7-2.4 1.7-2.4-.6-3 2.6-1.3 1-2.7h2.9Z" opacity="0.45" />
  </Svg>
);

export const IconChip = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.5 2.5 7 4M17 20l1.5 1.5M18.5 2.5 17 4M7 20l-1.5 1.5" opacity="0.6" />
  </Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </Svg>
);

export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5m-6 6 6-6 6 6" />
  </Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 13 4 4L19 7" />
  </Svg>
);

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V13M12 16.4v.1" />
  </Svg>
);

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

export const IconSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 9 19.5 11l-5.7 2L12 18.5 10.2 13 4.5 11l5.7-2Z" />
    <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" opacity="0.6" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 5.5v6c0 4.5 3 7.8 7 9.5 4-1.7 7-5 7-9.5v-6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const IconWaveform = (p: P) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
  </Svg>
);
