'use client';

import { usePublicSettings } from '@/lib/settings/client';

/**
 * THE MAINTENANCE NOTICE (2026-10-25, settings phase 1). Shown at the top of
 * every page -- public, farmer, buyer and staff portal alike, from the root
 * layout -- while an administrator has it switched on in Settings -> Security
 * and operations. Off, unset or unreadable, nothing is rendered at all.
 *
 * It informs; it does not block. Nothing stops working because it is on.
 */
export function MaintenanceBanner() {
  const settings = usePublicSettings();
  const notice = settings?.maintenance;
  if (!notice?.enabled || !notice.message) return null;
  return (
    <div
      role="status"
      className="no-print"
      dir="auto"
      style={{
        background: 'var(--sorghum-tint, #fdf3d8)',
        color: 'var(--ink, #1d1d1b)',
        borderBottom: '1px solid var(--sorghum, #e8c96a)',
        padding: '8px 16px',
        fontSize: 14,
        lineHeight: 1.4,
        textAlign: 'center',
      }}
    >
      {notice.message}
    </div>
  );
}
