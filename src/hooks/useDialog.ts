// Make a full-screen overlay card behave as a modal dialog for assistive tech.
//
// Overlays used to be plain divs: screen readers were never told a dialog had
// opened, focus stayed on whatever was clicked last, and Tab walked straight
// into the live board underneath. This hook moves focus to the dialog's title
// on mount and marks the sim layout behind it `inert` while any dialog is up.

import { useEffect, useId, useRef } from 'react';

let openDialogs = 0;

function setBackgroundInert(inert: boolean): void {
  const bg = document.querySelector('.sim-layout');
  if (!bg) return;
  if (inert) bg.setAttribute('inert', '');
  else bg.removeAttribute('inert');
}

export function useDialog() {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    openDialogs++;
    setBackgroundInert(true);
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) setBackgroundInert(false);
    };
  }, []);

  return {
    dialogProps: {
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': titleId,
    },
    titleProps: { id: titleId, ref: titleRef, tabIndex: -1 },
  };
}
