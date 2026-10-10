import { getContext, setContext } from 'svelte';

/** Callbacks the graph's custom nodes use to talk back to App. */
export interface Actions {
  toggleDone: (code: string) => void;
  expand: (code: string) => void;
}

const KEY = 'actions';

export const setActions = (actions: Actions): Actions => setContext(KEY, actions);
export const getActions = (): Actions => getContext<Actions>(KEY);
