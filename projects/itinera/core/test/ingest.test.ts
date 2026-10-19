import { describe, expect, it } from "vitest";
import { politeFetch, type HttpResponse } from "../src/ingest/http.js";
import { categorize, normalizeElements } from "../src/ingest/overpass.js";
import { cleanWikitext, parseListings } from "../src/ingest/wikivoyage.js";

describe("OSM normalization", () => {
  it("categorizes by the most specific tag", () => {
    expect(categorize({ tourism: "museum", historic: "palace" })).toBe("museum");
    expect(categorize({ historic: "castle", castle_type: "palace" })).toBe("palace");
    expect(categorize({ historic: "monastery" })).toBe("religious");
    expect(categorize({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(categorize({ tourism: "attraction" })).toBe("attraction");
  });

  it("dedupes elements sharing a Wikidata id, preferring the one with hours", () => {
    const places = normalizeElements([
      { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "A", tourism: "attraction", wikidata: "Q1" } },
      {
        type: "way",
        id: 2,
        center: { lat: 1, lon: 1 },
        tags: { name: "A", historic: "monastery", wikidata: "Q1", opening_hours: "Tu-Su 10:00-18:00" },
      },
      { type: "node", id: 3, tags: { name: "No coords" } },
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ osmId: "way/2", category: "religious", hoursRaw: "Tu-Su 10:00-18:00" });
  });
});

describe("Wikivoyage listings", () => {
  const wikitext = `==See==
* {{see
| name=Jerónimos Monastery | alt=Mosteiro dos Jerónimos | url=http://example.org
| wikidata=Q193547
| content=A '''masterpiece''' of the [[Manueline|Manueline style]], begun in 1501.{{ref|x}} Closed Mondays.
}}
* {{do | name=Tiny | content=short }}
* {{listing | type=eat | name=Cafe | content=Not a sight, should be skipped entirely.}}`;

  it("extracts see/do listings with Wikidata ids and clean text", () => {
    const listings = parseListings(wikitext, "Lisbon/Belém");
    expect(listings).toEqual([
      {
        name: "Jerónimos Monastery",
        wikidata: "Q193547",
        content: "A masterpiece of the Manueline style, begun in 1501. Closed Mondays.",
        page: "Lisbon/Belém",
      },
    ]);
  });

  it("cleans links and markup", () => {
    expect(cleanWikitext("See [[Belém]] and [https://x.org the site]&nbsp;now")).toBe("See Belém and the site now");
    expect(cleanWikitext("A {{UNESCO}} , the monastery {{x}}.")).toBe("A, the monastery.");
  });
});

describe("polite fetch", () => {
  it("retries on 429 and paces requests per host", async () => {
    const calls: string[] = [];
    const slept: number[] = [];
    let clock = 0;
    const ok = (status: number): HttpResponse => ({
      ok: status < 400,
      status,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const fetch = politeFetch(
      async (url, init) => {
        calls.push(`${url} ${init?.headers?.["User-Agent"]}`);
        return ok(calls.length === 1 ? 429 : 200);
      },
      {
        userAgent: "test-agent",
        minIntervalMs: { "example.org": 1000 },
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms);
          clock += ms;
        },
      },
    );
    await fetch("https://example.org/a");
    expect(calls).toEqual(["https://example.org/a test-agent", "https://example.org/a test-agent"]);
    expect(slept[0]).toBe(2000); // backoff after 429
  });
});
