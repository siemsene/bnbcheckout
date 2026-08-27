// UI-side task metadata: tool glyphs shown next to working characters, and the
// clean-overlay rectangles for room state (percent of the backdrop image).

import type { Skill } from '../engine/types';

export const TASK_TOOLS: Record<string, string> = {
  'strip-beds': '🧺',
  'make-breakfast': '🍳',
  'eat-breakfast': '🍽️',
  'clean-bedroom-1': '🧹',
  'clean-bedroom-2': '🧹',
  'clean-bedroom-3': '🧹',
  'clean-bathroom': '🧽',
  'tidy-kitchen': '🧼',
  'clean-living-room': '🧹',
  'pack-bag-1': '🧳',
  'pack-bag-2': '🧳',
  'pack-bag-3': '🧳',
  'fetch-car-a': '🔑',
  'fetch-car-b': '🔑',
  'buy-snacks': '🛍️',
  'load-car-a': '📦',
  'load-car-b': '📦',
  garbage: '🗑️',
  'call-mom': '📞',
  'buy-imodium': '💊',
  'guest-book': '✍️',
  'final-walkthrough': '📋',
};

/** Which CSS work-animation a skill gets on the character sprite. */
export const SKILL_ANIM: Record<Skill, string> = {
  cleaning: 'anim-scrub',
  cooking: 'anim-stir',
  heavy: 'anim-lift',
  shopping: 'anim-bob',
  driving: 'anim-bob',
  general: 'anim-bob',
};

/** Room rectangles on house-cutaway/house-clean (percent: x0, y0, x1, y1).
 * The clean twin overlays crossfade inside these as cleaning progresses. */
export const ROOM_CLEAN_RECTS: Record<string, [number, number, number, number]> = {
  'clean-bedroom-1': [7, 21, 29, 55.5],
  'clean-bedroom-2': [29, 21, 48.5, 55.5],
  'clean-bedroom-3': [48.5, 21, 69.5, 55.5],
  'clean-bathroom': [69.5, 21, 95.5, 55.5],
  'clean-living-room': [7, 55.5, 41, 94],
  'tidy-kitchen': [59, 55.5, 95.5, 94],
};
