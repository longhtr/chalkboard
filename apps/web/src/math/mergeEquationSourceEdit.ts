/**
 * Replays one contiguous canonical-source edit over a current collaborative
 * value. Non-overlapping edits merge; missing anchors fall back to the complete
 * edited value rather than dropping the local change.
 */
export function mergeEquationSourceEdit(
  base: string,
  edited: string,
  current: string,
): string {
  if (base === edited || current === edited) return current;
  if (current === base) return edited;

  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < edited.length &&
    base[prefix] === edited[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < edited.length - prefix &&
    base[base.length - suffix - 1] === edited[edited.length - suffix - 1]
  ) {
    suffix += 1;
  }

  const before = base.slice(0, prefix);
  const after = suffix === 0 ? '' : base.slice(base.length - suffix);
  const insertion = edited.slice(prefix, edited.length - suffix);
  const removed = base.slice(prefix, base.length - suffix);
  if (removed === '' && insertion !== '') {
    if (
      after === '' &&
      !base.endsWith(insertion) &&
      current.endsWith(insertion)
    )
      return current;
    if (
      before === '' &&
      !base.startsWith(insertion) &&
      current.startsWith(insertion)
    )
      return current;
    // An insertion at either document boundary does not need the entire
    // unchanged base to remain an anchor. Preserve edits made anywhere else in
    // the current source and apply the local boundary insertion around them.
    if (prefix === base.length && !base.endsWith(insertion)) {
      return current.startsWith(base)
        ? `${base}${insertion}${current.slice(base.length)}`
        : `${current}${insertion}`;
    }
    if (prefix === 0 && !base.startsWith(insertion)) {
      return `${insertion}${current}`;
    }
    const suffixIndex = after === '' ? -1 : current.lastIndexOf(after);
    if (
      suffixIndex >= insertion.length &&
      base.slice(Math.max(0, prefix - insertion.length), prefix) !==
        insertion &&
      current.slice(suffixIndex - insertion.length, suffixIndex) === insertion
    ) {
      return current;
    }
  }
  const beforeIndex = before === '' ? 0 : current.indexOf(before);
  if (beforeIndex < 0) return edited;
  const start = beforeIndex + before.length;
  const anchorEnd = after === '' ? current.length : current.lastIndexOf(after);
  if (anchorEnd < start) return edited;
  if (
    removed === '' &&
    insertion !== '' &&
    current.slice(start, start + insertion.length) === insertion
  ) {
    return current;
  }

  let replacementStart = start;
  let replacementEnd = start;
  if (removed !== '') {
    const removedIndex = current.indexOf(removed, start);
    if (removedIndex >= start && removedIndex + removed.length <= anchorEnd) {
      replacementStart = removedIndex;
      replacementEnd = removedIndex + removed.length;
    } else {
      replacementEnd = anchorEnd;
    }
  }
  return `${current.slice(0, replacementStart)}${insertion}${current.slice(replacementEnd)}`;
}
