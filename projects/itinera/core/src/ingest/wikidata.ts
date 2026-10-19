/** Labels, short descriptions, images and notability (sitelink counts) from Wikidata. */
import { z } from "zod";
import { query, type HttpFetch } from "./http.js";

const Snak = z.object({
  mainsnak: z.object({
    datavalue: z.object({ value: z.unknown() }).optional(),
  }),
});

const Entity = z.object({
  id: z.string(),
  missing: z.string().optional(),
  labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
  descriptions: z.record(z.string(), z.object({ value: z.string() })).optional(),
  claims: z.record(z.string(), z.array(Snak)).optional(),
  sitelinks: z.record(z.string(), z.object({ title: z.string() })).optional(),
});

const EntitiesResponse = z.object({ entities: z.record(z.string(), Entity) });

export interface WikidataInfo {
  id: string;
  label: string | null;
  description: string | null;
  /** Commons file name from P18, without the "File:" prefix. */
  image: string | null;
  sitelinkCount: number;
  enwiki: string | null;
  enwikivoyage: string | null;
}

export async function fetchEntities(fetch: HttpFetch, ids: readonly string[]): Promise<Map<string, WikidataInfo>> {
  const out = new Map<string, WikidataInfo>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?${query({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|descriptions|claims|sitelinks",
      languages: "en",
      format: "json",
      origin: "*",
    })}`;
    const data = EntitiesResponse.parse(await (await fetch(url)).json());
    for (const e of Object.values(data.entities)) {
      if (e.missing !== undefined) continue;
      const image = e.claims?.P18?.[0]?.mainsnak.datavalue?.value;
      out.set(e.id, {
        id: e.id,
        label: e.labels?.en?.value ?? null,
        description: e.descriptions?.en?.value ?? null,
        image: typeof image === "string" ? image : null,
        sitelinkCount: Object.keys(e.sitelinks ?? {}).length,
        enwiki: e.sitelinks?.enwiki?.title ?? null,
        enwikivoyage: e.sitelinks?.enwikivoyage?.title ?? null,
      });
    }
  }
  return out;
}

const SparqlResponse = z.object({
  results: z.object({
    bindings: z.array(z.record(z.string(), z.object({ value: z.string() }))),
  }),
});

/** ISO 4217 currency of a country by ISO 3166-1 alpha-2 code. */
export async function fetchCountryCurrency(fetch: HttpFetch, isoCode: string): Promise<string | null> {
  if (!/^[A-Z]{2}$/.test(isoCode)) throw new Error(`Bad ISO code ${isoCode}`);
  const sparql = `SELECT ?code WHERE { ?c wdt:P297 "${isoCode}"; wdt:P38 ?cur. ?cur wdt:P498 ?code. } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?${query({ query: sparql, format: "json" })}`;
  const data = SparqlResponse.parse(
    await (await fetch(url, { headers: { Accept: "application/sparql-results+json" } })).json(),
  );
  return data.results.bindings[0]?.code?.value ?? null;
}
