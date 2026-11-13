import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { looksLikeUrl, pickLink, viewedAgo, type LinkSuggestion, type PickedLink } from "../linkPicker";
import IssueTypeIcon from "./IssueTypeIcon";
import Spinner from "./Spinner";

/**
 * The link box, laid out like Jira's: "Dán hoặc tìm liên kết", "Chữ hiển thị", and under them what the viewer
 * opened last in Jira (nothing typed) or the issues whose title or key matches. A row is linked by a click or
 * Enter; an address typed is linked as it is. Used by the rich editor (floating at the cursor) and by the task's
 * "+ Thêm liên kết" (in place).
 *
 * Esc closes the box only, never the window it sits in.
 */

// The same question within a minute is not asked again (opening the box twice, typing then deleting).
const CACHE_MS = 60_000;
const held = new Map<string, { at: number; rows: LinkSuggestion[] }>();

function cached(q: string): LinkSuggestion[] | undefined {
  const hit = held.get(q);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.rows : undefined;
}

interface Props {
  initialUrl?: string;
  initialText?: string;
  onApply: (link: PickedLink) => void;
  onCancel: () => void;
  /** Editing a link that exists: offers "Bỏ liên kết". */
  onRemove?: () => void;
  className?: string;
}

export default function LinkPicker({ initialUrl = "", initialText = "", onApply, onCancel, onRemove, className }: Props) {
  const [query, setQuery] = useState(initialUrl);
  const [display, setDisplay] = useState(initialText);
  // The answer for the text as it is now (held within a minute, or just back); while the next one is on its way
  // the last one stays, so the list does not blink at every key.
  const [answer, setAnswer] = useState<{ q: string; rows: LinkSuggestion[] } | null>(null);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const isUrl = looksLikeUrl(query);
  const q = query.trim();
  const rows = isUrl ? [] : (cached(q) ?? answer?.rows ?? null);

  useEffect(() => {
    if (isUrl || cached(q)) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        api.linkSuggestions(q).then(
          (found) => {
            held.set(q, { at: Date.now(), rows: found });
            if (alive) setAnswer({ q, rows: found });
          },
          () => alive && setAnswer({ q, rows: [] })
        ),
      q ? 200 : 0
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, isUrl]);

  const shown = rows ?? [];
  // Enter picks only from the answer to what is typed now, never from the list still showing the last one.
  const fresh = isUrl ? [] : (cached(q) ?? (answer?.q === q ? answer.rows : []));
  const picked = pickLink(query, display, fresh, active);

  function apply(link: PickedLink | null) {
    if (link) onApply(link);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      apply(picked);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length > 0) {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (active + 1) % shown.length : active <= 0 ? shown.length - 1 : active - 1;
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div className={`lp${className ? ` ${className}` : ""}`} role="group" aria-label="Gắn liên kết" onKeyDown={onKeyDown}>
      <label className="lp-field">
        <span>Dán hoặc tìm liên kết</span>
        <input
          autoFocus
          value={query}
          aria-label="Địa chỉ liên kết"
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
        />
      </label>
      <label className="lp-field">
        <span>Chữ hiển thị (không bắt buộc)</span>
        <input value={display} aria-label="Chữ hiển thị của liên kết" onChange={(e) => setDisplay(e.target.value)} />
      </label>

      {!isUrl &&
        (rows === null ? (
          <Spinner block className="spinner-inline" />
        ) : shown.length > 0 ? (
          <ul ref={listRef} className="lp-list" role="listbox" aria-label={q ? "Kết quả" : "Đã xem gần đây"}>
            {shown.map((s, i) => {
              const ago = viewedAgo(s.lastViewed);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`lp-row${i === active ? " is-active" : ""}`}
                    title={`${s.key} · ${s.summary}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(pickLink("", display, shown, i))}
                  >
                    <IssueTypeIcon type={s.issueType} size={16} />
                    <span className="lp-text">
                      <span className="lp-title">
                        <span className="lp-key">{s.key}</span> {s.summary}
                      </span>
                      <span className="lp-meta">{[s.projectName, ago].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          q && <p className="lp-empty">Không tìm thấy.</p>
        ))}

      <div className="lp-foot">
        {onRemove && (
          <button type="button" className="lp-remove" onClick={onRemove}>
            Bỏ liên kết
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Huỷ
        </button>
        <button type="button" className="primary tonal" disabled={!picked} onClick={() => apply(picked)}>
          {initialUrl ? "Lưu" : "Thêm"}
        </button>
      </div>
    </div>
  );
}
