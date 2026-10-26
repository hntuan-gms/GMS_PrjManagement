import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface Suggestion {
  value: string;
  /** Shown after the value, dimmed (an issue's title beside its key). */
  hint?: string;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "list"> {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  /** A suggestion was chosen (click, or Enter on the highlighted one). Defaults to putting its value in the box. */
  onPick?: (value: string) => void;
  /** How many matches to list. */
  limit?: number;
}

/** Case- and diacritic-insensitive, so "dang nhap" finds "đăng nhập". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * A text box with completions in the app's own list, replacing `<datalist>`: the browser draws
 * that one itself — its own font, spacing and highlight — and it cannot be styled to match
 * anything else on the screen.
 *
 * The list is portalled and fixed-positioned: the boxes it sits in (a scrolling side panel, a
 * modal body) clip anything that hangs out of them.
 */
export default function SuggestInput({ value, onChange, suggestions, onPick, limit = 8, onKeyDown, onFocus, onBlur, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const listId = useId();

  const q = fold(value.trim());
  const matches = suggestions
    .filter((s) => s.value !== value && (q === "" || fold(`${s.value} ${s.hint ?? ""}`).includes(q)))
    .slice(0, limit);
  const showing = open && matches.length > 0;

  useLayoutEffect(() => {
    if (!showing) return;
    function place() {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      // Opens upward when the room below is short and the room above is the larger.
      if (below < 220 && r.top > below) setBox({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 });
      else setBox({ left: r.left, width: r.width, top: r.bottom + 4 });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showing, matches.length]);

  // Keep the highlighted row inside the list's own scroll.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function pick(v: string) {
    if (onPick) onPick(v);
    else onChange(v);
    setOpen(false);
    setActive(-1);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (showing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = matches.length;
        setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
        return;
      }
      if (e.key === "Enter" && active >= 0 && matches[active]) {
        e.preventDefault();
        pick(matches[active].value);
        return;
      }
      if (e.key === "Escape") {
        // Closes the list only: the window behind it must not take the same Escape.
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
        return;
      }
    } else if (e.key === "ArrowDown") {
      setOpen(true);
    }
    onKeyDown?.(e);
  }

  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(e);
        }}
        onKeyDown={handleKey}
      />
      {showing &&
        box &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            className="suggest-list"
            style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
            // Taking focus off the box would close the list before the click lands.
            onMouseDown={(e) => e.preventDefault()}
          >
            {matches.map((s, i) => (
              <li
                key={s.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`suggest-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s.value)}
              >
                <b>{s.value}</b>
                {s.hint && <span>{s.hint}</span>}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
