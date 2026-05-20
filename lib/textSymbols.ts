/** Unicode punctuation via escapes (safe when source files are not saved as UTF-8). */

export const MIDDLE_DOT = "\u00b7";
export const ARROW_RIGHT = "\u2192";
export const EM_DASH = "\u2014";
export const TRIANGLE_RIGHT = "\u25b6";

/** Spaced middle dot, e.g. "a · b". */
export const SEP_DOT = ` ${MIDDLE_DOT} `;

/** Spaced right arrow, e.g. "Step A → Step B". */
export const SEP_ARROW = ` ${ARROW_RIGHT} `;
