/**
 * Domain schemas. Every row that crosses a boundary (database, seed bundle,
 * ingestion output) is parsed with these, and the TypeScript types are
 * inferred from them so the two never drift.
 */
import { z } from "zod";
import { isIsoDate } from "./dates.js";

export const isoDate = z.string().refine(isIsoDate, "expected YYYY-MM-DD");
export const isoTimestamp = z.string().min(10);
export const id = z.string().min(1);

export const THEMES = ["romantic", "solo", "adventure", "nature", "historical", "culture"] as const;
export const ThemeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof ThemeSchema>;

export const PLACE_CATEGORIES = [
  "museum",
  "gallery",
  "monument",
  "castle",
  "palace",
  "religious",
  "viewpoint",
  "park",
  "garden",
  "attraction",
  "zoo",
  "theatre",
  "square",
  "waterfall",
  "lake",
  "nature_reserve",
  "peak",
  "beach",
  "other",
] as const;
export const PlaceCategorySchema = z.enum(PLACE_CATEGORIES);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

/** Bounding box as [west, south, east, north] in degrees. */
export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

export const SourceLinkSchema = z.object({ label: z.string(), url: z.string() });
export type SourceLink = z.infer<typeof SourceLinkSchema>;

/** Attribution a source's licence requires wherever its content is shown. */
export const AttributionSchema = z.object({
  text: z.string(),
  url: z.string().nullable(),
  license: z.string().nullable(),
  licenseUrl: z.string().nullable(),
});
export type Attribution = z.infer<typeof AttributionSchema>;

// ---------------------------------------------------------------- catalog

export const CountrySchema = z.object({
  id,
  name: z.string(),
  isoCode: z.string().length(2),
  currency: z.string().nullable(),
});
export type Country = z.infer<typeof CountrySchema>;

export const CitySchema = z.object({
  id,
  countryId: id,
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  bbox: BBoxSchema,
  themeTags: z.array(ThemeSchema),
  osmRelationId: z.number().int().nullable(),
  wikidata: z.string().nullable(),
  source: z.string(),
  fetchedAt: isoTimestamp,
});
export type City = z.infer<typeof CitySchema>;

export const PlaceSchema = z.object({
  id,
  cityId: id,
  name: z.string(),
  category: PlaceCategorySchema,
  lat: z.number(),
  lon: z.number(),
  /** OSM opening_hours string, kept raw; parsed on use. */
  hoursRaw: z.string().nullable(),
  description: z.string().nullable(),
  descriptionAttribution: AttributionSchema.nullable(),
  themeTags: z.array(ThemeSchema),
  photoPath: z.string().nullable(),
  photoAttribution: AttributionSchema.nullable(),
  sources: z.array(SourceLinkSchema),
  osmId: z.string(),
  wikidata: z.string().nullable(),
  /** Notability score used to pick and order "great places". */
  rank: z.number(),
  source: z.string(),
  fetchedAt: isoTimestamp,
});
export type Place = z.infer<typeof PlaceSchema>;

export const ClimateNormalSchema = z.object({
  cityId: id,
  dayOfYear: z.number().int().min(1).max(366),
  tminP10: z.number(),
  tminP50: z.number(),
  tminP90: z.number(),
  tmaxP10: z.number(),
  tmaxP50: z.number(),
  tmaxP90: z.number(),
  /** Share of years with ≥ 1 mm precipitation on this day (smoothed). */
  rainProb: z.number().min(0).max(1),
  /** Mean daily precipitation in mm. */
  precipMm: z.number().min(0),
});
export type ClimateNormal = z.infer<typeof ClimateNormalSchema>;

export const TRANSPORT_MODES = ["walk", "transit", "road", "rail", "bus", "ferry", "flight"] as const;
export const TransportModeSchema = z.enum(TRANSPORT_MODES);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const RouteEdgeSchema = z.object({
  fromCityId: id,
  toCityId: id,
  mode: TransportModeSchema,
  typicalMinutes: z.number().positive(),
  direct: z.boolean(),
});
export type RouteEdge = z.infer<typeof RouteEdgeSchema>;

export const PriceKindSchema = z.enum(["flight", "stay"]);
export type PriceKind = z.infer<typeof PriceKindSchema>;

export const PriceObservationSchema = z.object({
  id,
  kind: PriceKindSchema,
  /** Route ("LIS-BOM") for flights, city id for stays. */
  key: z.string(),
  travelDate: isoDate,
  price: z.number().positive(),
  currency: z.string().length(3),
  source: z.string(),
  observedAt: isoTimestamp,
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

export const PriceBandSchema = z.object({
  kind: PriceKindSchema,
  key: z.string(),
  /** 1–12 for a month-specific band, 0 for the annual band. */
  month: z.number().int().min(0).max(12),
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
  n: z.number().int().nonnegative(),
  spanStart: isoDate,
  spanEnd: isoDate,
  currency: z.string().length(3),
});
export type PriceBand = z.infer<typeof PriceBandSchema>;

// -------------------------------------------------------------- itinerary

export const TRIP_STATES = ["wishlist", "idea", "planning", "ready", "on_trip", "done"] as const;
export const TripStateSchema = z.enum(TRIP_STATES);
export type TripState = z.infer<typeof TripStateSchema>;

export const TripSchema = z.object({
  id,
  name: z.string().min(1),
  originCityId: id.nullable(),
  state: TripStateSchema,
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  createdAt: isoTimestamp,
});
export type Trip = z.infer<typeof TripSchema>;

export const LegSchema = z.object({
  id,
  tripId: id,
  cityId: id,
  order: z.number().int().nonnegative(),
  nights: z.number().int().nonnegative(),
  isStopover: z.boolean(),
});
export type Leg = z.infer<typeof LegSchema>;

export const TransferSchema = z.object({
  id,
  tripId: id,
  fromLegId: id,
  toLegId: id,
  mode: TransportModeSchema,
  estMinutes: z.number().nonnegative(),
  departDayId: id.nullable(),
});
export type Transfer = z.infer<typeof TransferSchema>;

export const DaySchema = z.object({
  id,
  legId: id,
  date: isoDate,
  index: z.number().int().nonnegative(),
});
export type Day = z.infer<typeof DaySchema>;

export const SLOT_PARTS = ["morning", "afternoon", "evening"] as const;
export const SlotPartSchema = z.enum(SLOT_PARTS);
export type SlotPart = z.infer<typeof SlotPartSchema>;

export const SlotSchema = z.object({
  id,
  dayId: id,
  part: SlotPartSchema,
  order: z.number().int().nonnegative(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ItemSchema = z.object({
  id,
  slotId: id,
  placeId: id.nullable(),
  customName: z.string().nullable(),
  order: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
  /** Planned visit length; null means the category default. */
  durationMin: z.number().int().positive().nullable(),
  estCost: z.number().nonnegative().nullable(),
  notes: z.string().nullable(),
});
export type Item = z.infer<typeof ItemSchema>;

export const WishlistEntrySchema = z.object({
  id,
  placeId: id,
  savedAt: isoTimestamp,
  note: z.string().nullable(),
});
export type WishlistEntry = z.infer<typeof WishlistEntrySchema>;

// ----------------------------------------------------------------- system

export const CACHE_CATEGORIES = [
  "geocode",
  "places",
  "hours",
  "descriptions",
  "photos",
  "climate",
  "travel_times",
  "routes",
  "stay_prices",
  "flight_prices",
  "tiles",
] as const;
export const CacheCategorySchema = z.enum(CACHE_CATEGORIES);
export type CacheCategory = z.infer<typeof CacheCategorySchema>;

export const CacheStatusSchema = z.enum(["ok", "error", "refreshing"]);
export type CacheStatus = z.infer<typeof CacheStatusSchema>;

export const CacheEntrySchema = z.object({
  key: z.string(),
  category: CacheCategorySchema,
  fetchedAt: isoTimestamp,
  /** Days until stale; null means it never expires. */
  ttlDays: z.number().nonnegative().nullable(),
  status: CacheStatusSchema,
});
export type CacheEntry = z.infer<typeof CacheEntrySchema>;

export const TilePackSchema = z.object({
  id,
  region: z.string(),
  bbox: BBoxSchema,
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  builtAt: isoTimestamp,
});
export type TilePack = z.infer<typeof TilePackSchema>;
