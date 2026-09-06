import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";

type PartsSearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
};

export function PartsSearchInput({ value, onValueChange }: PartsSearchInputProps) {
  const [draft, setDraft] = useState(value);
  const isComposingRef = useRef(false);
  const lastCommittedValueRef = useRef(value);

  useEffect(() => {
    lastCommittedValueRef.current = value;
    if (!isComposingRef.current) setDraft(value);
  }, [value]);

  function commit(nextValue: string) {
    if (nextValue === lastCommittedValueRef.current) return;
    lastCommittedValueRef.current = nextValue;
    onValueChange(nextValue);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setDraft(nextValue);

    if (!isComposingRef.current) {
      commit(nextValue);
    }
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    isComposingRef.current = false;
    const nextValue = event.currentTarget.value;
    setDraft(nextValue);
    commit(nextValue);
  }

  return (
    <input
      aria-label="部品を検索"
      className="h-8 min-w-[220px] rounded border border-slate-300 px-2 text-xs sm:min-w-[260px]"
      placeholder="型番・メーカー・メモ・属性を検索"
      value={draft}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  );
}
