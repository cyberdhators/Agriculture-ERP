import { redirect } from 'next/navigation';

/**
 * The learning library left the farmer's dashboard on 2026-10-17 (the owner:
 * AgriOne AI replaces it). Old links, bookmarks and saved pages land on the
 * assistant. The library itself is still managed by staff.
 */
export default function FarmerLearnPage() {
  redirect('/farmer/account/ai');
}
