// The community color scale the network map and the People table share.
//
// Community numbers come from the shell (src/ui/actions.js orderCommunities:
// by size on first load, matched by overlap after a rebuild), and colors
// follow the number, so a community that survives a rebuild keeps its color.

import { categoricalScale } from './palette.js';

// Hues on the map: all eight slots stay apart under every color-vision
// deficiency for every pair, so any two communities may sit side by side;
// the rest share "Other groups" and are told apart by their number at the
// cluster.
export const MAP_HUES = 8;

export function communityScale(communities) {
  if (!communities) return null;
  const k = communities.count ?? 0;
  return categoricalScale(Array.from({ length: k }, (_, i) => String(i)), { hues: MAP_HUES });
}
