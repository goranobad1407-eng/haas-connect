// Simple reactive state — a single AppState object with typed subscribers.
// No framework, no proxy magic. Components call state.set(...) and subscribe
// to specific keys they care about.

import type { AppState, Language } from "./types/index";

type Listener<K extends keyof AppState> = (value: AppState[K]) => void;

class Store {
  private _state: AppState = {
    config: null,
    config_warnings: [],
    selected_machine: null,
    machine_statuses: new Map(),
    machine_current_path: null,
    machine_breadcrumb: [],
    machine_entries: [],
    selected_machine_entry: null,
    local_root: null,
    local_current_path: null,
    local_breadcrumb: [],
    local_entries: [],
    local_search_results: null,
    selected_local_entry: null,
    selected_local_entries: [],
    active_selection: null,
    preview: null,
    is_loading_machine_directory: false,
    is_loading_local_directory: false,
    is_loading_local_search: false,
    is_checking: false,
    is_loading_preview: false,
    status_message: "Spreman",
    language: "hr" as Language,
  };

  // Map from state key → list of listeners.
  private _listeners: Map<keyof AppState, Array<Listener<keyof AppState>>> =
    new Map();

  get<K extends keyof AppState>(key: K): AppState[K] {
    return this._state[key];
  }

  set<K extends keyof AppState>(key: K, value: AppState[K]): void {
    this._state[key] = value;
    const listeners = this._listeners.get(key) ?? [];
    for (const fn of listeners) {
      (fn as Listener<K>)(value);
    }
  }

  /** Update multiple keys at once. Fires each key's listeners individually. */
  patch(partial: Partial<AppState>): void {
    for (const [key, value] of Object.entries(partial) as Array<
      [keyof AppState, AppState[keyof AppState]]
    >) {
      this.set(key, value);
    }
  }

  subscribe<K extends keyof AppState>(key: K, fn: Listener<K>): () => void {
    const list = this._listeners.get(key) ?? [];
    list.push(fn as Listener<keyof AppState>);
    this._listeners.set(key, list);
    // Return an unsubscribe function.
    return () => {
      const current = this._listeners.get(key) ?? [];
      this._listeners.set(
        key,
        current.filter((l) => l !== (fn as Listener<keyof AppState>))
      );
    };
  }

  /** Convenience: set machine_status for one machine id. */
  setMachineStatus(
    id: string,
    status: AppState["machine_statuses"] extends Map<string, infer S>
      ? S
      : never
  ): void {
    const map = new Map(this._state.machine_statuses);
    map.set(id, status);
    this.set("machine_statuses", map);
  }

  snapshot(): AppState {
    return { ...this._state };
  }
}

// Export a singleton. All components share one store.
export const state = new Store();
