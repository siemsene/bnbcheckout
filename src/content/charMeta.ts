// UI-side character metadata: colors, placeholder glyphs, scene labels.
// Sprite art replaces the glyphs in the asset phase.

import type { Activity, CharId } from '../engine/types';

export const CHAR_META: Record<
  CharId,
  { color: string; short: string; glyph: string }
> = {
  sora: { color: 'var(--c-sora)', short: 'So', glyph: '🧭' },
  kenji: { color: 'var(--c-kenji)', short: 'Ke', glyph: '🚗' },
  mei: { color: 'var(--c-mei)', short: 'Me', glyph: '🍳' },
  taro: { color: 'var(--c-taro)', short: 'Ta', glyph: '💪' },
  hana: { color: 'var(--c-hana)', short: 'Ha', glyph: '🧽' },
};

export const ACTIVITY_META: Record<
  Activity,
  { icon: string; label: string; nudgeable?: boolean }
> = {
  idle: { icon: '💤', label: 'idle' },
  walking: { icon: '🚶', label: 'walking' },
  working: { icon: '', label: 'working' },
  distracted: { icon: '🐦', label: 'distracted — click to nudge', nudgeable: true },
  oncall: { icon: '📱', label: 'on the phone — click to nudge', nudgeable: true },
  toilet: { icon: '🚽', label: 'emergency… give them a minute' },
  walkback: { icon: '↩️', label: 'walking back' },
};
