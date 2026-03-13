import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Transaction } from "@/lib/types";
import {
  getUniqueMerchants,
  matchMerchants,
} from "@/services/merchant-categorization";

interface MerchantInputProps {
  value: string;
  onChange: (merchant: string) => void;
  /** Called when the user picks a suggestion from the dropdown. */
  onSelect?: (merchant: string) => void;
  transactions: Transaction[];
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Forwarded — fires only for key events the component doesn't consume. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Forwarded. */
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

export function MerchantInput({
  value,
  onChange,
  onSelect,
  transactions,
  className,
  placeholder = "Merchant",
  autoFocus = false,
  onKeyDown,
  onBlur,
}: MerchantInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const merchants = useMemo(
    () => getUniqueMerchants(transactions),
    [transactions],
  );

  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    const matches = matchMerchants(merchants, value.trim());
    // Don't show dropdown if the only match is exactly what's typed
    if (matches.length === 1 && matches[0].toLowerCase() === value.trim().toLowerCase()) return [];
    return matches.slice(0, 20);
  }, [merchants, value]);

  // Auto-focus + select
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSuggestion = (merchant: string) => {
    onChange(merchant);
    setOpen(false);
    onSelect?.(merchant);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === "Enter" && highlightIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "Tab") {
        setOpen(false);
        // Let Tab propagate naturally
      }
    }
    onKeyDown?.(e);
  };

  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up pending blur timer on unmount
  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Delay close so mousedown on a suggestion can fire first
    blurTimerRef.current = setTimeout(() => setOpen(false), 150);
    onBlur?.(e);
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[highlightIndex]) {
      (items[highlightIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  // Position the dropdown relative to the input using fixed positioning
  // so it escapes any overflow:hidden ancestors (e.g. table cells).
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const showDropdown = open && suggestions.length > 0;

  useLayoutEffect(() => {
    if (!showDropdown || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 200),
    });
  }, [showDropdown]);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={className}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {showDropdown &&
        createPortal(
          <div
            style={dropdownStyle}
            className="z-50 rounded-lg border border-border bg-popover p-1 shadow-md"
          >
            <div ref={listRef} className="max-h-48 overflow-y-auto">
              {suggestions.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`w-full text-left rounded-sm px-2 py-1.5 text-sm cursor-default transition-colors ${
                    i === highlightIndex
                      ? "bg-muted text-foreground"
                      : "text-popover-foreground hover:bg-muted/50"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur
                    selectSuggestion(m);
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
