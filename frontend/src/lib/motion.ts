/**
 * Motion rules for the desktop app. Two jobs only: show what changed (a view or profile switching, a
 * field confirming, an error arriving) and mark the one moment the app comes to life (sign-in). Everything
 * checks `reducedMotion()` first; with it on, elements appear in their final state at once.
 *
 * The HUD canvases draw their own frames and never go through here.
 */

import { animate, stagger, type JSAnimation } from 'animejs';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function settle(targets: Element[] | NodeListOf<Element>) {
  for (const element of Array.from(targets)) (element as HTMLElement).style.opacity = '1';
}

/** Rises a group of elements into place, one after the other. Returns null when motion is off. */
export function riseIn(targets: Element[] | NodeListOf<Element>, { step = 60, distance = 14, duration = 480, delay = 0 } = {}): JSAnimation | null {
  const list = Array.from(targets);
  if (list.length === 0) return null;
  if (reducedMotion()) {
    settle(list);
    return null;
  }
  return animate(list, { opacity: [0, 1], y: [distance, 0], duration, delay: stagger(step, { start: delay }), ease: 'outCubic' });
}

/** A short sideways shake for something that was refused (a wrong password, an unreachable server). */
export function shake(target: Element): void {
  if (reducedMotion()) return;
  animate(target, { x: [0, -6, 6, -4, 4, 0], duration: 420, ease: 'inOutSine' });
}
