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
  'nudge-onmyway': {
    charId: 'sora',
    lines: ['Hold on, I’ll go get them…', 'Sora to the rescue. Again.'],
  },
  'nudge-already-fine': {
    lines: ['…what? I was already working!', 'You walked all the way over for this?'],
  },
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
  'walkback-buy-imodium': {
    charId: 'taro',
    lines: ['I was AT THE COUNTER. Do you understand what you have done.'],
  },

  // --- Personal errands -----------------------------------------------------
  'not-mine-sora': { lines: ['That’s not mine to do — it has to be them.'] },
  'not-mine-kenji': { lines: ['Pretty sure that one isn’t mine.'] },
  'not-mine-mei': { lines: ['That’s not my errand!'] },
  'not-mine-taro': { lines: ['Not my job. Genuinely, not my job.'] },
  'not-mine-hana': { lines: ['Ooh, that’s someone else’s to do.'] },
  'imodium-holding': {
    charId: 'taro',
    lines: [
      'The pharmacy run is paying off. Crisis averted.',
      'I felt that one coming and… nothing. Modern medicine.',
    ],
  },
  'call-mom-done': {
    charId: 'mei',
    lines: ['Mum says hi to everyone and asks why we never call.'],
  },
  'guest-book-done': {
    charId: 'hana',
    lines: ['Note written. I drew a little house on it. Five stars.'],
  },

  // --- New chaos ------------------------------------------------------------
  doorbell: {
    lines: [
      'Oh no, it’s the neighbor. “Lovely weather—” here we go.',
      'Doorbell! …It’s a story about their tomatoes. A long story.',
    ],
  },
  'cat-mess': {
    lines: ['THE CAT knocked the cushions everywhere and left. Majestic. Infuriating.'],
  },
  'cat-visit': {
    lines: ['A cat just walked in like it pays rent here.'],
  },
  spill: {
    lines: ['Pan flip gone wrong. The kitchen now has… texture. More dishes to do.'],
  },
  music: {
    lines: ['Road-trip playlist ON. Suddenly everyone has 10% more energy. 🎵'],
  },
  'no-vacuum': {
    lines: [
      'Someone else has the vacuum — I’ll sweep by hand… slowly.',
      'ONE vacuum cleaner. FIVE people. Whose idea was this?',
    ],
  },
  'no-shopping-list': {
    lines: ['Buying snacks from memory… what does Taro even eat? This will take a while.'],
  },
  'found-shopping-list': {
    lines: ['The shopping list was under the sofa! Snack run just got way easier.'],
  },

  // --- Flavor ---------------------------------------------------------------
  'flavor-wifi': {
    lines: ['The wifi died. Morale is shaken but we carry on.'],
  },
  'flavor-selfie': {
    lines: ['Quick group selfie for the trip album! Okay okay, back to work.'],
  },
  'flavor-keys': {
    lines: ['Brief panic: where are the house keys? …In the door. They were in the door.'],
  },
};

/** Idle chatter for ambient life; shown occasionally by the UI, not the engine. */
export const AMBIENT: Partial<Record<CharId, string[]>> = {
  sora: [
    'Okay team, we’ve got this.',
    'Checklist. Checklist. Where’s the checklist.',
    'Two hours is PLENTY. Probably.',
    'Remember: we lose the deposit if this place isn’t spotless.',
  ],
  kenji: [
    'I call shotgun. Wait, I’m driving.',
    'Road trip playlist is READY.',
    'If my boss calls again I’m throwing my phone in the lake.',
    'Did anyone see where I put the parking ticket?',
  ],
  mei: [
    'Breakfast is the most important meal of the checkout.',
    'That bird is back. Hello, bird.',
    'I’m adding gummy sharks to the snack list. Non-negotiable.',
  ],
  taro: [
    'I can carry all three bags. At once.',
    'Never trusting street food again.',
    'My stomach just made a sound I did not authorize.',
  ],
  hana: [
    'This place was so cute. Five stars.',
    'Anyone want to clean TOGETHER? Anyone?',
    'Found ANOTHER sock. Whose is this??',
  ],
};

export function bubbleText(textKey: string, tick: number): string | null {
  const spec = BUBBLES[textKey];
  if (!spec) return null;
  return spec.lines[tick % spec.lines.length];
}
