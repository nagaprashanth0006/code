/**
 * HTTP for ingestion, injected by the platform (Node fetch, Tauri's HTTP
 * plugin, or the browser). Adds per-host pacing, retries with backoff on
 * 429/5xx, and identification headers the free sources ask for.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type HttpFetch = (url: string, init?: HttpInit) => Promise<HttpResponse>;

export interface PoliteOptions {
  /** Identifies the app to Wikimedia, Nominatim and Overpass operators. */
  userAgent: string;
  /** In a browser the User-Agent header can't be set; Wikimedia accepts Api-User-Agent instead. */
  browser?: boolean;
  /** Minimum gap between requests to a host, in ms. */
  minIntervalMs?: Record<string, number>;
  retries?: number;
  /** Abort a request that hasn't produced a response in this long. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Published limits: Nominatim max 1 req/s; Overpass prefers no parallel requests. */
export const DEFAULT_HOST_INTERVALS: Record<string, number> = {
  "nominatim.openstreetmap.org": 1100,
  "overpass-api.de": 1000,
  "www.wikidata.org": 200,
  "query.wikidata.org": 500,
  "en.wikivoyage.org": 200,
  "commons.wikimedia.org": 200,
  "upload.wikimedia.org": 100,
  "thumb.wikimedia.org": 100,
  "archive-api.open-meteo.com": 500,
};

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function politeFetch(fetch: HttpFetch, options: PoliteOptions): HttpFetch {
  const intervals = { ...DEFAULT_HOST_INTERVALS, ...options.minIntervalMs };
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const nextSlot = new Map<string, number>();

  async function waitTurn(host: string): Promise<void> {
    const gap = intervals[host] ?? 0;
    const at = Math.max(now(), nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + gap);
    const delay = at - now();
    if (delay > 0) await sleep(delay);
  }

  return async (url, init = {}) => {
    const host = new URL(url).host;
    const headers: Record<string, string> = { ...init.headers };
    if (options.browser) {
      if (host.endsWith("wikimedia.org") || host.endsWith("wikidata.org") || host.endsWith("wikivoyage.org")) {
        headers["Api-User-Agent"] = options.userAgent;
      }
    } else {
      headers["User-Agent"] = options.userAgent;
    }
    for (let attempt = 0; ; attempt++) {
      await waitTurn(host);
      let res: HttpResponse;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        res = await fetch(url, { ...init, headers, signal: abort.signal });
      } catch (e) {
        if (attempt >= retries) {
          if (abort.signal.aborted) throw new HttpError(url, 0, `Timed out after ${timeoutMs / 1000} s: ${host}`);
          // The raw error ("error sending request for url …") hides the usual causes.
          throw new HttpError(
            url,
            0,
            `Couldn't reach ${host}. Check the internet connection, or a proxy set in the environment (https_proxy) that isn't reachable. (${e instanceof Error ? e.message : String(e)})`,
          );
        }
        await sleep(1000 * 2 ** attempt);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new HttpError(url, res.status, `HTTP ${res.status} from ${host}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
    }
  };
}

export function query(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}
