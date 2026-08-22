export interface Replacement {
  from: number;
  to: number;
  insert: string;
}

/** Minimal single-span replacement turning oldText into newText, or null if identical. */
export function computeReplacement(oldText: string, newText: string): Replacement | null {
  if (oldText === newText) return null;

  const maxCommon = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < maxCommon && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }

  return {
    from: prefix,
    to: oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}
