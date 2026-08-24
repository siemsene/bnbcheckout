// UI-side character metadata: colors, art assets, activity labels.

import type { Activity, CharId } from '../engine/types';

export const CHAR_META: Record<
  CharId,
  { color: string; short: string; glyph: string; ref: string; front: string; walk: string }
> = {
  sora: {
    color: 'var(--c-sora)',
    short: 'So',
    glyph: '🧭',
    ref: '/assets/chars/sora-ref.png',
    front: '/assets/chars/sora-chibi-front.png',
    walk: '/assets/chars/sora-chibi-walk.png',
  },
  kenji: {
    color: 'var(--c-kenji)',
    short: 'Ke',
    glyph: '🚗',
    ref: '/assets/chars/kenji-ref.png',
    front: '/assets/chars/kenji-chibi-front.png',
    walk: '/assets/chars/kenji-chibi-walk.png',
  },
  mei: {
    color: 'var(--c-mei)',
    short: 'Me',
    glyph: '🍳',
    ref: '/assets/chars/mei-ref.png',
    front: '/assets/chars/mei-chibi-front.png',
    walk: '/assets/chars/mei-chibi-walk.png',
  },
  taro: {
    color: 'var(--c-taro)',
    short: 'Ta',
    glyph: '💪',
    ref: '/assets/chars/taro-ref.png',
    front: '/assets/chars/taro-chibi-front.png',
    walk: '/assets/chars/taro-chibi-walk.png',
  },
  hana: {
    color: 'var(--c-hana)',
    short: 'Ha',
    glyph: '🧽',
    ref: '/assets/chars/hana-ref.png',
    front: '/assets/chars/hana-chibi-front.png',
    walk: '/assets/chars/hana-chibi-walk.png',
  },
};

export const ACTIVITY_META: Record<
  Activity,
  { icon: string; label: string; nudgeable?: boolean }
> = {
  idle: { icon: '💤', label: 'idle' },
  walking: { icon: '', label: 'walking' },
  working: { icon: '', label: 'working' },
  distracted: { icon: '🐦', label: 'distracted — click to nudge', nudgeable: true },
  oncall: { icon: '📱', label: 'on the phone — click to nudge', nudgeable: true },
  toilet: { icon: '🚽', label: 'emergency… give them a minute' },
  walkback: { icon: '↩️', label: 'walking back' },
};
