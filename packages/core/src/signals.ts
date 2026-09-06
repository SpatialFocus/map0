/** Minimal reactive primitives — deliberately tiny, no framework dependency. */

export type Unsubscribe = () => void;

/** the reading half of a Signal — what the api hands out; writing is the owner's business */
export interface ReadonlySignal<T> {
  readonly value: T;
  subscribe(fn: (value: T) => void, opts?: { immediate?: boolean }): Unsubscribe;
}

export class Signal<T> implements ReadonlySignal<T> {
  #value: T;
  #subs = new Set<(v: T) => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T {
    return this.#value;
  }

  set value(next: T) {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const fn of [...this.#subs]) fn(next);
  }

  subscribe(fn: (v: T) => void, opts?: { immediate?: boolean }): Unsubscribe {
    this.#subs.add(fn);
    if (opts?.immediate) fn(this.#value);
    return () => this.#subs.delete(fn);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** the subscribing half of an Emitter — what the api hands out; `emit` stays inside */
export interface EventSubscriber<Events extends Record<string, any>> {
  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): Unsubscribe;
}

export class Emitter<Events extends Record<string, any>> implements EventSubscriber<Events> {
  #subs = new Map<keyof Events, Set<(payload: any) => void>>();

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): Unsubscribe {
    let set = this.#subs.get(event);
    if (!set) this.#subs.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#subs.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear(): void {
    this.#subs.clear();
  }
}
