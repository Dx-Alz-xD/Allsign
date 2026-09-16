'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Samples a hot-path value (a ref the DSP mutates in place) into React state
 * at a modest rate, so readouts update without re-rendering per audio frame.
 * `read` must return a new object when anything the caller cares about changed.
 */
export function usePolled<T>(read: () => T, hz = 8, equals: (a: T, b: T) => boolean = shallowEqual): T {
  const [value, setValue] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = readRef.current();
      setValue((current) => (equals(current, next) ? current : next));
    }, 1000 / hz);
    return () => window.clearInterval(timer);
  }, [hz, equals]);

  return value;
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}
