// UI-side character metadata: colors, art assets, activity labels.

import type { Activity, CharId } from '../engine/types';

/** Hover-tooltip hints: enough to plan with, without spelling out exact numbers. */
export const CHAR_HINTS: Record<CharId, { strengths: string[]; watchouts: string[] }> = {
  sora: {
    strengths: ['Solid at everything', 'The only one who can nudge the others'],
    watchouts: ['No driving license', 'Nudging someone means walking over — her own task waits'],
  },
  kenji: {
    strengths: ['Has a license — fastest driver', 'Quick with heavy-ish jobs'],
    watchouts: ['Terrible cook', 'His boss keeps calling; he stops working until nudged'],
  },
  mei: {
    strengths: ['Brilliant cook', 'Knows everyone’s snacks — fast shopper'],
    watchouts: [
      'No license',
      'Drifts off (birds, phone) and needs nudging',
      'Owes her mother a phone call — only she can make it',
    ],
  },
  taro: {
    strengths: ['Very strong — luggage, garbage, loading', 'Focused when working alone'],
    watchouts: [
      'No license',
      'Noticeably slower when sharing a task',
      'That street food last night… bathroom emergencies happen',
      'A pharmacy run would head most of those off — the sooner the better',
    ],
  },
  hana: {
    strengths: ['Meticulous cleaner', 'Has a license', 'Thrives working WITH someone'],
    watchouts: [
      'Sluggish when left alone',
      'Cleans so thoroughly she finds forgotten items — expect repacking',
      'Promised the host a guest-book note — hers to write',
    ],
  },
};

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
