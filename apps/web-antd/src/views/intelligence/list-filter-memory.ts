import type { Ref } from 'vue';

import { ref, watch } from 'vue';

import { session } from './session';

function compatible(value: unknown, fallback: unknown): boolean {
  if (fallback === undefined) return typeof value === 'string';
  if (fallback === null)
    return (
      value === null || (typeof value === 'number' && Number.isFinite(value))
    );
  if (Array.isArray(fallback))
    return (
      Array.isArray(value) && value.every((item) => typeof item === 'string')
    );
  if (typeof fallback === 'object')
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(fallback).every(([key, initial]) =>
        compatible((value as Record<string, unknown>)[key], initial),
      )
    );
  return (
    typeof value === typeof fallback &&
    (typeof value !== 'number' || Number.isFinite(value))
  );
}

/** Only explicitly registered list controls are stored; record selections and forms are transient. */
export function useListFilterMemory(list: string) {
  const key = `hci-list-filters-v1:${session.user?.id || 'local'}:${list}`;
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      saved = parsed as Record<string, unknown>;
  } catch {
    // A blocked storage area or an older invalid value must not prevent listing.
  }
  function bind<T>(name: string, target: Ref<T>) {
    if (Object.hasOwn(saved, name) && compatible(saved[name], target.value))
      target.value = saved[name] as T;
    watch(
      target,
      (value) => {
        saved[name] = value;
        try {
          localStorage.setItem(key, JSON.stringify(saved));
        } catch {
          // Browsing continues when storage is unavailable or full.
        }
      },
      { deep: true, flush: 'sync' },
    );
    return target;
  }
  function field<T>(name: string, initial: T): Ref<T> {
    return bind(name, ref(initial) as Ref<T>);
  }
  return { field, bind };
}
