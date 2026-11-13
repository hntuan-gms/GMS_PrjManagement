import { adfMediaIds, richImageSources, type MediaRef } from "./adf.js";
import { badRequest } from "./errors.js";
import type { JiraClient } from "./jiraClient.js";
import { attachmentIdOf, mediaIdOf } from "./richText.js";

/**
 * Pictures in comments and descriptions. Jira's ADF names a picture by its media-service id; the
 * REST API names an attachment by a number. The text this app speaks (richText.ts) uses
 * `attachment:<number>` wherever the two can be matched — so the panel can draw it through
 * `/tasks/:id/attachments/:attId/content` — and `media:<uuid>` where they cannot (kept as it was).
 */

/** At most this many attachments are looked up to match the pictures of one read. */
const MAX_LOOKUPS = 40;
const LOOKUP_PARALLEL = 8;

type AttachmentInfo = { id: string; filename: string; mimeType?: string };

async function mapLimited<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i]);
      }
    })
  );
  return out;
}

/**
 * Media id → attachment, for the pictures these documents show. Pictures first, newest first, and it
 * stops once every id is matched. Any failure leaves the rest unmatched (they read as `media:`).
 */
export async function attachmentMatcher(
  jira: JiraClient,
  key: string,
  docs: unknown[]
): Promise<((mediaId: string) => { id: string; filename: string } | undefined) | undefined> {
  const wanted = new Set(docs.flatMap((d) => adfMediaIds(d)));
  if (wanted.size === 0) return undefined;
  const found = new Map<string, AttachmentInfo>();
  try {
    const files = (await jira.getAttachments(key))
      .map((f) => ({ id: String(f.id), filename: f.filename, mimeType: f.mimeType, created: f.created }))
      .sort((a, b) => Number(/^image\//.test(b.mimeType)) - Number(/^image\//.test(a.mimeType)) || String(b.created).localeCompare(String(a.created)))
      .slice(0, MAX_LOOKUPS);
    await mapLimited(files, LOOKUP_PARALLEL, async (f) => {
      if (found.size >= wanted.size) return;
      const media = await jira.attachmentMediaId(f.id).catch(() => null);
      if (media && wanted.has(media)) found.set(media, f);
    });
  } catch {
    /* unmatched pictures stay `media:` */
  }
  return (mediaId) => found.get(mediaId);
}

/**
 * What every picture of `text` is written as. An `attachment:<id>` must be a file of this issue —
 * a number alone would reach any issue on the site — and is refused otherwise.
 */
export async function mediaForWrite(jira: JiraClient, key: string, text: string): Promise<((src: string) => MediaRef | undefined) | undefined> {
  const sources = richImageSources(text);
  if (sources.length === 0) return undefined;
  const refs = new Map<string, MediaRef>();
  for (const src of sources) {
    const media = mediaIdOf(src);
    if (media) refs.set(src, { kind: "file", id: media });
  }
  const attIds = [...new Set(sources.map(attachmentIdOf).filter((x): x is string => !!x))];
  if (attIds.length > 0) {
    const own = new Set((await jira.getAttachments(key)).map((f) => String(f.id)));
    const foreign = attIds.filter((id) => !own.has(id));
    if (foreign.length > 0) throw badRequest("Ảnh trong nội dung không thuộc việc này.");
    await mapLimited(attIds, LOOKUP_PARALLEL, async (id) => {
      const media = await jira.attachmentMediaId(id).catch(() => null);
      if (media) refs.set(`attachment:${id}`, { kind: "file", id: media });
      // Written as "[name]" instead (the file stays attached); logged so a change on Jira's side shows.
      else console.warn(`[rich-media] ${key}: no media id for attachment ${id}`);
    });
  }
  return (src) => refs.get(src);
}
