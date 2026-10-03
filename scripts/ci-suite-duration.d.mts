/** Types for the suite's expected duration. Implementation is `.mjs` so CI runs it with no loader. */
export declare const EXPECTED_BAND_MINUTES: { readonly min: number; readonly max: number };
export declare const TIMEOUT_MINUTES: number;
export declare function durationComplaint(elapsedSeconds: number): string | null;
