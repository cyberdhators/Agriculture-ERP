import type { TKey } from './en';

/**
 * Arabi Juba text is supplied by CORWADO (scope §Not in this phase: no
 * additional interface languages beyond what CORWADO supplies). Do not
 * machine-translate.
 *
 * Only the two language labels are supplied at this point — the name of each
 * selectable language, shown in its own script. Every other key falls back to
 * English through `t()` until CORWADO delivers the translated strings, which
 * land key by key here with no change to the screens.
 */
export const arJuba: Partial<Record<TKey, string>> = {
  'language.name': 'English',
  'language.arjubaName': 'عربي جوبا',
};
