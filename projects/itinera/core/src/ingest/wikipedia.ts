/** Article summaries from English Wikipedia's REST API (text CC BY-SA). */
import { z } from "zod";
import type { HttpFetch } from "./http.js";

const Summary = z.object({
  extract: z.string().optional(),
  wikibase_item: z.string().optional(),
  coordinates: z.object({ lat: z.number(), lon: z.number() }).optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }).optional(),
  originalimage: z.object({ source: z.string() }).optional(),
});

export interface WikipediaSummary {
  extract: string | null;
  wikidata: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
  /** The article's lead image as a Commons file name, when it is hosted on Commons. */
  image: string | null;
}

/** "Hoi_An_(I).jpg" from an upload.wikimedia.org/wikipedia/commons/… URL; null for local (non-Commons) files. */
export function commonsFileFromUrl(url: string): string | null {
  const m = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(url);
  return m ? decodeURIComponent(m[1]!).replace(/_/g, " ") : null;
}

export async function fetchWikipediaSummary(fetch: HttpFetch, title: string): Promise<WikipediaSummary> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const s = Summary.parse(await (await fetch(url)).json());
  return {
    extract: s.extract ?? null,
    wikidata: s.wikibase_item ?? null,
    lat: s.coordinates?.lat ?? null,
    lon: s.coordinates?.lon ?? null,
    url: s.content_urls?.desktop.page ?? null,
    image: s.originalimage ? commonsFileFromUrl(s.originalimage.source) : null,
  };
}

/** The first sentences of an extract, up to about `max` characters. */
export function shortSummary(extract: string, max = 320): string {
  const sentences = extract.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(\s|$)/g) ?? [extract];
  let out = "";
  for (const s of sentences) {
    if (out && (out + s).length > max) break;
    out += s;
  }
  return out.trim();
}
