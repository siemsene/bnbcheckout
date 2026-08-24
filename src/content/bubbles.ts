// All character dialogue lives here as DOM text (never baked into images).
// Keys match the textKeys emitted by the engine; unknown keys fall back to the
// ticker only. Multiple variants are rotated deterministically by tick.

import type { CharId } from '../engine/types';

export interface BubbleSpec {
  lines: string[];
  /** Override which character says it (engine may omit charId). */
  charId?: CharId;
}

export const BUBBLES: Record<string, BubbleSpec> = {
  // --- Hidden-constraint discovery -----------------------------------------
  'no-license-mei': {
    lines: ['A car? I never got my license!', 'Unless you want me to drive illegally…?'],
  },
  'no-license-taro': {
    lines: ['I can bench-press the car, but I can’t drive it.'],
  },
  'no-license-sora': {
    lines: ['I keep meaning to get my license… so, no.'],
  },
  'kenji-cooking': {
    lines: ['Cooking? Last time I made toast the smoke alarm filed a complaint.'],
  },
  'taro-crowded': {
    lines: ['I work better alone, just saying.', 'Too many elbows in here.'],
  },
  'stranger-bag-sora': { lines: ['Whose charger is this?? Why are there nine?'] },
  'stranger-bag-kenji': { lines: ['Is this… a souvenir rock collection?'] },
  'stranger-bag-mei': { lines: ['I don’t know whose socks these are and I’m scared.'] },
  'stranger-bag-taro': { lines: ['This is not my bag. Folding is hard.'] },
  'stranger-bag-hana': { lines: ['Packing someone else’s stuff feels so nosy!'] },

  // --- Interruptions --------------------------------------------------------
  'phone-start': {
    lines: [
      'Sorry — it’s my boss. Yes?? No, I’m not “on vacation-vacation”…',
      'One sec, boss is calling AGAIN.',
    ],
  },
  'distracted-start': {
    lines: [
      'Ooh, look at that bird!',
      'Just checking one tiny notification…',
      'Wait, this cloud looks exactly like a capybara.',
    ],
  },
  'toilet-start': {
    lines: [
      'The street food!! It has betrayed me!! MOVE!',
      'Emergency. Do NOT time me.',
    ],
  },
  'nudged-sora': { lines: ['On it!'] },
  'nudged-kenji': { lines: ['Right — sorry, boss, gotta go. Family emergency. Sort of.'] },
  'nudged-mei': { lines: ['Hm? Oh! Right, checkout. Focus, Mei.'] },
  'nudged-taro': { lines: ['I was focused THE WHOLE TIME.'] },
  'nudged-hana': { lines: ['Okay okay, back to work!'] },
  'nudge-toilet-futile': {
    lines: ['Some things cannot be nudged.', 'PLEASE respect my privacy right now.'],
  },

  // --- Rework ---------------------------------------------------------------
  'rework-bathroom': {
    charId: 'taro',
    lines: ['…I am so sorry about the bathroom. Again.'],
  },
  'found-item-clean-bedroom-1': {
    lines: ['Found a phone charger behind the bed! Whose bag does this go in?'],
  },
  'found-item-clean-bedroom-2': {
    lines: ['There’s a whole camera under the pillow?!'],
  },
  'found-item-clean-bedroom-3': {
    lines: ['Somebody’s passport was IN THE SHEETS.'],
  },
  'found-item-clean-living-room': {
    lines: ['A wallet in the couch cushions. Classic couch.'],
  },
  'rework-walkthrough': {
    lines: ['Wait — grandma’s teapot is still behind the sofa! Unload the car!!'],
  },

  // --- Global moods ---------------------------------------------------------
  hangry: {
    lines: ['Everyone’s getting hangry… we really should have eaten something.'],
  },
  'walkback-fetch-car-a': { lines: ['I was HALFWAY to the garage!'] },
  'walkback-fetch-car-b': { lines: ['Fine. Walking back. Great use of my morning.'] },
  'walkback-buy-snacks': { lines: ['But… the snacks were right there…'] },

  // --- Flavor ---------------------------------------------------------------
  'flavor-cat': {
    lines: ['A cat just walked in like it pays rent here.'],
  },
  'flavor-neighbor': {
    lines: ['The neighbor wants to chat about the weather. It is going to be long.'],
  },
  'flavor-wifi': {
    lines: ['The wifi died. Morale is shaken but we carry on.'],
  },
};

/** Idle chatter for ambient life; shown occasionally by the UI, not the engine. */
export const AMBIENT: Partial<Record<CharId, string[]>> = {
  sora: ['Okay team, we’ve got this.', 'Checklist. Checklist. Where’s the checklist.'],
  kenji: ['I call shotgun. Wait, I’m driving.', 'Road trip playlist is READY.'],
  mei: ['Breakfast is the most important meal of the checkout.'],
  taro: ['I can carry all three bags. At once.', 'Never trusting street food again.'],
  hana: ['This place was so cute. Five stars.', 'Anyone want to clean TOGETHER? Anyone?'],
};

export function bubbleText(textKey: string, tick: number): string | null {
  const spec = BUBBLES[textKey];
  if (!spec) return null;
  return spec.lines[tick % spec.lines.length];
}
