import { lazy, Suspense, useState, type ComponentProps } from "react";
import { loadRichEditor } from "../richEditorLoad";

/**
 * The rich text box, loaded on first use: TipTap/ProseMirror is about 140 KB gzipped, and the page
 * a project opens on never needs it — only the task detail does. Until it arrives, a box of the same
 * look stands in; pressed meanwhile, the real box takes the caret when it lands.
 */
const RichEditor = lazy(loadRichEditor);

export default function RichEditorLazy(props: ComponentProps<typeof RichEditor>) {
  const [wanted, setWanted] = useState(false);
  return (
    <Suspense
      fallback={
        <div className={`re re-wait${props.bare ? " is-bare" : ""}`} aria-busy="true" onMouseDown={() => setWanted(true)}>
          <div className="re-content rt">
            <div className="re-wait-box" data-placeholder={props.placeholder} />
          </div>
        </div>
      }
    >
      <RichEditor {...props} autoFocus={props.autoFocus || wanted} />
    </Suspense>
  );
}
