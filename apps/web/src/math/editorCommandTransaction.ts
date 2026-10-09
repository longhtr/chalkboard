/** Applies one completed LaTeX command and its arguments without exposing intermediate field states. */
export class EditorCommandTransaction {
  #anchor: number | null = null;

  get active(): boolean {
    return this.#anchor !== null;
  }

  begin(fieldOffset: number): void {
    this.#anchor = Math.max(0, Math.trunc(fieldOffset));
  }

  clear(): void {
    this.#anchor = null;
  }

  consumeAnchor(lastFieldOffset: number): number | null {
    if (this.#anchor === null) return null;
    const anchor = Math.min(
      this.#anchor,
      Math.max(0, Math.trunc(lastFieldOffset)),
    );
    this.#anchor = null;
    return anchor;
  }
}
