/**
 * Numeric inspector field with a local text draft. It clamps only on commit so
 * temporary values such as an empty string remain editable.
 */
import { useRef, useState, type ComponentProps } from 'react';

interface NumberInputProps extends Omit<
  ComponentProps<'input'>,
  'max' | 'min' | 'onChange' | 'type' | 'value'
> {
  maximum: number;
  minimum: number;
  onValueChange(value: number): void;
  value: number;
}

export function NumberInput({
  maximum,
  minimum,
  onValueChange,
  onFocus,
  onKeyDown,
  onBlur,
  value,
  ...props
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const commit = (input: HTMLInputElement) => {
    if (draft === null) return;
    const parsed = input.valueAsNumber;
    if (Number.isFinite(parsed)) {
      onValueChange(Math.min(maximum, Math.max(minimum, parsed)));
    }
    setDraft(null);
  };

  return (
    <input
      {...props}
      type="number"
      min={minimum}
      max={maximum}
      value={draft ?? value}
      onFocus={(event) => {
        cancelRef.current = false;
        setDraft(event.currentTarget.value);
        event.currentTarget.select();
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const parsed = event.currentTarget.valueAsNumber;
        if (nextDraft !== '' && Number.isFinite(parsed)) {
          onValueChange(Math.min(maximum, Math.max(minimum, parsed)));
        }
      }}
      onBlur={(event) => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(null);
        } else {
          commit(event.currentTarget);
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelRef.current = true;
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
