// The community color scale the network map and the People table share.
//
// Community numbers come from the shell (src/ui/actions.js orderCommunities:
// by size on first load, matched by overlap after a rebuild), and colors
// follow the number, so a community that survives a rebuild keeps its color.

import { categoricalScale } from './palette.js';

// Hues on the map: any two communities can sit side by side there, so only
// slots that stay apart under every color-vision deficiency are used; the
// rest share "Other" and are told apart by their number at the cluster.
export const MAP_HUES = 5;

export function communityScale(communities) {
  if (!communities) return null;
  const k = communities.count ?? 0;
  return categoricalScale(Array.from({ length: k }, (_, i) => String(i)), { hues: MAP_HUES });
}
