/**
 * Place descriptions from Wikivoyage "see"/"do" listings, matched to OSM
 * places by Wikidata id (or by name as a fallback). Wikivoyage text is
 * CC BY-SA, so every description keeps an attribution with a page link.
 */
import { z } from "zod";
import { query, type HttpFetch } from "./http.js";

export interface Listing {
  name: string;
  wikidata: string | null;
  content: string;
  page: string;
}

const LISTING_TEMPLATES = new Set(["see", "do", "listing"]);

/** Splits a template body on top-level "|" (ignoring pipes inside [[ ]] and {{ }}). */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      current += two;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      current += two;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += body[i];
    }
  }
  parts.push(current);
  return parts;
}

/** Top-level templates in wikitext, as [name, body] pairs. */
function templates(wikitext: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{") {
      if (depth === 0) start = i + 2;
      depth++;
      i++;
    } else if (two === "}}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const inner = wikitext.slice(start, i);
        const bar = inner.indexOf("|");
        const name = (bar < 0 ? inner : inner.slice(0, bar)).trim().toLowerCase();
        out.push([name, bar < 0 ? "" : inner.slice(bar + 1)]);
      }
      i++;
    }
  }
  return out;
}

export function cleanWikitext(text: string): string {
  let s = text;
  s = s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Drop templates, innermost first.
  for (let guard = 0; guard < 10 && /\{\{[^{}]*\}\}/.test(s); guard++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1").replace(/\[https?:\/\/\S+\]/g, "");
  s = s.replace(/'{2,}/g, "");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");
  s = s.replace(/\s+/g, " ");
  // Removed templates leave gaps before punctuation ("A {{tmpl}}, the …" → "A , the …").
  s = s.replace(/\s+([,.;:])/g, "$1").replace(/([,;:])(?=[,;:.])/g, "").replace(/^[,;:.]\s*/, "");
  return s.trim();
}

export function parseListings(wikitext: string, page: string): Listing[] {
  const out: Listing[] = [];
  for (const [name, body] of templates(wikitext)) {
    if (!LISTING_TEMPLATES.has(name)) continue;
    const params = new Map<string, string>();
    for (const part of splitParams(body)) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }
    if (name === "listing" && !["see", "do"].includes((params.get("type") ?? "").toLowerCase())) continue;
    const listingName = cleanWikitext(params.get("name") ?? "");
    const content = cleanWikitext(params.get("content") ?? params.get("description") ?? "");
    if (!listingName || content.length < 20) continue;
    const wikidata = params.get("wikidata")?.trim();
    out.push({ name: listingName, wikidata: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : null, content, page });
  }
  return out;
}

const AllPages = z.object({
  query: z.object({ allpages: z.array(z.object({ title: z.string() })) }),
  continue: z.object({ apcontinue: z.string() }).optional(),
});

const Revisions = z.object({
  query: z.object({
    pages: z.array(
      z.object({
        title: z.string(),
        missing: z.boolean().optional(),
        revisions: z
          .array(z.object({ slots: z.object({ main: z.object({ content: z.string() }) }) }))
          .optional(),
      }),
    ),
  }),
});

const API = "https://en.wikivoyage.org/w/api.php";

/** The city article and its district subpages ("Lisbon", "Lisbon/Belém", …). */
export async function cityPages(fetch: HttpFetch, title: string): Promise<string[]> {
  const titles = [title];
  let cont: string | undefined;
  do {
    const url = `${API}?${query({
      action: "query",
      list: "allpages",
      apprefix: `${title}/`,
      apnamespace: 0,
      aplimit: 50,
      apcontinue: cont,
      format: "json",
      origin: "*",
    })}`;
    const data = AllPages.parse(await (await fetch(url)).json());
    titles.push(...data.query.allpages.map((p) => p.title));
    cont = data.continue?.apcontinue;
  } while (cont && titles.length < 200);
  return titles;
}

export async function fetchListings(fetch: HttpFetch, titles: readonly string[]): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url = `${API}?${query({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: batch.join("|"),
      format: "json",
      formatversion: 2,
      origin: "*",
    })}`;
    const data = Revisions.parse(await (await fetch(url)).json());
    for (const p of data.query.pages) {
      const content = p.revisions?.[0]?.slots.main.content;
      if (content) out.push(...parseListings(content, p.title));
    }
  }
  return out;
}

export const wikivoyageUrl = (page: string) => `https://en.wikivoyage.org/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`;

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
