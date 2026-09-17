/**
 * Shared motion rules for the site.
 *
 * Three kinds of motion, and only three: the one page-load sequence in the hero, scroll-linked storytelling
 * (the pipeline, the readout, section reveals) and motion that answers what the visitor does (tabs, hover,
 * checkout steps). Everything routes through here so `prefers-reduced-motion` switches all of it to an
 * instant, static presentation.
 */

import { animate, onScroll, stagger, utils, type JSAnimation } from 'animejs';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Elements start hidden through this class; with reduced motion they are simply shown. */
export const HIDDEN = 'opacity-0';

function show(targets: Element | Element[] | NodeListOf<Element>) {
  const list = targets instanceof Element ? [targets] : Array.from(targets);
  for (const element of list) (element as HTMLElement).style.opacity = '1';
}

interface RevealOptions {
  /** Delay between children, in ms. */
  step?: number;
  /** Vertical travel in px. */
  distance?: number;
  duration?: number;
  /** Where in the viewport the reveal starts; anime.js threshold syntax. */
  enter?: string;
}

/** Reveals `targets` once, the first time they scroll into view. */
export function revealOnScroll(targets: string | Element[] | NodeListOf<Element>, trigger: Element, options: RevealOptions = {}): JSAnimation | null {
  const { step = 80, distance = 22, duration = 700, enter = 'bottom-=12% top' } = options;
  const list = typeof targets === 'string' ? Array.from(trigger.querySelectorAll(targets)) : Array.from(targets);
  if (list.length === 0) return null;
  if (reducedMotion()) {
    show(list);
    return null;
  }
  return animate(list, {
    opacity: [0, 1],
    y: [distance, 0],
    duration,
    delay: stagger(step),
    ease: 'outCubic',
    autoplay: onScroll({ target: trigger, enter, repeat: false }),
  });
}

/** Tweens a number into an element's text, formatted by `format`, when the element scrolls into view. */
export function countUpOnScroll(element: HTMLElement, to: number, format: (value: number) => string, duration = 1400): JSAnimation | null {
  if (reducedMotion()) {
    element.textContent = format(to);
    return null;
  }
  const state = { value: 0 };
  element.textContent = format(0);
  return animate(state, {
    value: to,
    duration,
    ease: 'outExpo',
    onUpdate: () => {
      element.textContent = format(state.value);
    },
    autoplay: onScroll({ target: element, enter: 'bottom-=10% top', repeat: false }),
  });
}

/** Tweens a number from its current value to `to`, for a change the visitor caused (a toggle, a slider). */
export function tweenNumber(element: HTMLElement, from: number, to: number, format: (value: number) => string, duration = 600): void {
  if (reducedMotion() || from === to) {
    element.textContent = format(to);
    return;
  }
  const state = { value: from };
  animate(state, {
    value: to,
    duration,
    ease: 'outQuart',
    modifier: utils.round(2),
    onUpdate: () => {
      element.textContent = format(state.value);
    },
  });
}
