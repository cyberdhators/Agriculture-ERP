import type { SVGProps } from 'react';

/**
 * Inline icons, 24 grid, 1.75 stroke. No icon library: one fewer dependency
 * and no font download in the field. Icons are decorative (aria-hidden): the
 * design rule is that every icon has a visible label, so the label carries
 * the meaning and the icon never has to.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12 4.5 4.5L19 7" />
  </Icon>
);

export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconWarn = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 2.5 20h19L12 3Z" />
    <path d="M12 9v5M12 17.5v.5" />
  </Icon>
);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.5" />
  </Icon>
);

export const IconPhone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </Icon>
);

export const IconMail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Icon>
);

export const IconPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);

export const IconEdit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m13.5 7.5 3 3" />
  </Icon>
);

export const IconRemove = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14 6-6 6 6 6" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 6 6 6-6 6" />
  </Icon>
);

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12h16M13 5l7 7-7 7" />
  </Icon>
);

export const IconPrint = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 8V3h10v5M6 17H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
    <rect x="7" y="14" width="10" height="7" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </Icon>
);

export const IconExternal = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const IconEyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3l18 18M10.6 6.3A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 6.6C3.7 8.5 2 12 2 12s3.5 6 10 6a10 10 0 0 0 3.3-.5" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

/* Navigation */

export const IconDashboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="5" rx="2" />
    <rect x="13" y="10" width="8" height="11" rx="2" />
    <rect x="3" y="13" width="8" height="8" rx="2" />
  </Icon>
);

export const IconFarmers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
  </Icon>
);

export const IconDirectory = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Z" />
    <path d="M18 8h2v10a2 2 0 0 1-2 2M8 9h6M8 13h6" />
  </Icon>
);

export const IconLibrary = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z" />
  </Icon>
);

export const IconPalette = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4A2 2 0 0 1 15.8 14H18a3 3 0 0 0 3-3 8 8 0 0 0-9-8Z" />
    <path d="M7.5 12h.01M10 8h.01M14 8h.01" strokeWidth={3} />
  </Icon>
);

/* Learning resource formats. Each has a label wherever it appears. */

export const IconPdf = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h8l5 5v13H6V3Z" />
    <path d="M14 3v5h5M9 17v-5h1.8a1.5 1.5 0 0 1 0 3H9" />
  </Icon>
);

export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.75" />
    <path d="m4 18 5.5-5 3.5 3 3-2.5L20 18" />
  </Icon>
);

export const IconAudio = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10v4h3l5 4V6L7 10H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const IconVideo = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Icon>
);
