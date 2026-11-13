/**
 * The rich text box's code (TipTap/ProseMirror, ~140 KB gzipped) as its own chunk: loaded by
 * components/RichEditorLazy when a box is drawn, and started early by the workspace as soon as a task
 * is selected or opened, so the detail usually finds it already here.
 */
export const loadRichEditor = () => import("./components/RichEditor");

export const preloadRichEditor = () => void loadRichEditor();
