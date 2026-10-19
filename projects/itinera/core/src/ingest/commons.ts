/** Photo thumbnails and their required attribution from Wikimedia Commons. */
import { z } from "zod";
import type { Attribution } from "../schemas.js";
import { query, type HttpFetch } from "./http.js";
import { cleanWikitext } from "./wikivoyage.js";

const Meta = z.object({ value: z.union([z.string(), z.number()]) }).optional();

const ImageInfoResponse = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z.array(
        z.object({
          title: z.string(),
          missing: z.boolean().optional(),
          imageinfo: z
            .array(
              z.object({
                thumburl: z.string().optional(),
                descriptionurl: z.string(),
                extmetadata: z
                  .object({
                    Artist: Meta,
                    LicenseShortName: Meta,
                    LicenseUrl: Meta,
                    AttributionRequired: Meta,
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

export interface CommonsImage {
  file: string;
  thumbUrl: string;
  attribution: Attribution;
}

// Wikimedia serves a fixed set of thumbnail widths; 500 is one of them.
export const THUMB_WIDTH = 500;

export async function fetchImageInfo(fetch: HttpFetch, files: readonly string[]): Promise<Map<string, CommonsImage>> {
  const out = new Map<string, CommonsImage>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const url = `https://commons.wikimedia.org/w/api.php?${query({
      action: "query",
      titles: batch.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: THUMB_WIDTH,
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|AttributionRequired",
      format: "json",
      formatversion: 2,
      origin: "*",
    })}`;
    const data = ImageInfoResponse.parse(await (await fetch(url)).json());
    // Map normalized titles ("File:A b.jpg") back to the names we asked for.
    const back = new Map<string, string>();
    for (const f of batch) back.set(`File:${f}`, f);
    for (const n of data.query?.normalized ?? []) {
      const original = back.get(n.from);
      if (original) back.set(n.to, original);
    }
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      const file = back.get(page.title);
      if (!info?.thumburl || !file) continue;
      const meta = info.extmetadata;
      const artist = meta?.Artist ? cleanWikitext(String(meta.Artist.value)) : "Unknown author";
      out.set(file, {
        file,
        thumbUrl: info.thumburl,
        attribution: {
          text: artist || "Unknown author",
          url: info.descriptionurl,
          license: meta?.LicenseShortName ? String(meta.LicenseShortName.value) : null,
          licenseUrl: meta?.LicenseUrl ? String(meta.LicenseUrl.value) : null,
        },
      });
    }
  }
  return out;
}
