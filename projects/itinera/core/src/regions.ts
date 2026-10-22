/**
 * World regions for browsing and filtering, by ISO 3166-1 alpha-2 country
 * code. Loosely the UN geoscheme, grouped the way travellers think of it
 * (Mexico and the Caribbean with Latin America, the Caucasus with the Middle
 * East). Countries not listed fall under "other".
 */
export const REGIONS = [
  { id: "south-asia", label: "South Asia", countries: "IN NP BT LK MV PK BD AF" },
  { id: "southeast-asia", label: "Southeast Asia", countries: "TH ID SG MY VN KH LA MM PH BN TL" },
  { id: "east-asia", label: "East Asia", countries: "JP KR KP CN HK MO TW MN" },
  { id: "central-asia", label: "Central Asia", countries: "KZ UZ KG TJ TM" },
  {
    id: "middle-east",
    label: "Middle East & Caucasus",
    countries: "AE OM QA BH KW SA YE JO IL PS LB SY IQ IR TR GE AM AZ",
  },
  {
    id: "africa",
    label: "Africa",
    countries:
      "EG MA TN DZ LY SD ET KE TZ UG RW BI SO DJ ER ZA NA BW ZW ZM MZ MW MG MU SC KM RE AO CD CG CM GA GQ NG GH CI SN GM GN GW SL LR ML BF NE TD CF BJ TG MR CV ST LS SZ SS",
  },
  {
    id: "europe",
    label: "Europe",
    countries:
      "PT ES AD FR MC IT SM VA MT GR CY HR SI BA RS ME MK AL XK BG RO MD UA BY RU HU SK CZ AT CH LI DE PL LT LV EE FI SE NO DK IS IE GB NL BE LU",
  },
  { id: "north-america", label: "North America", countries: "US CA GL BM" },
  {
    id: "latin-america",
    label: "Latin America & Caribbean",
    countries:
      "MX GT BZ HN SV NI CR PA CU JM HT DO PR BS BB TT LC VC GD AG KN DM AW CW CO VE EC PE BO BR PY UY AR CL GY SR",
  },
  { id: "oceania", label: "Oceania", countries: "AU NZ FJ PG SB VU NC PF WS TO KI FM MH PW NR TV CK" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"] | "other";

const byCountry = new Map<string, RegionId>(REGIONS.flatMap((r) => r.countries.split(" ").map((c) => [c, r.id] as const)));

export function regionOf(countryCode: string): RegionId {
  return byCountry.get(countryCode.toUpperCase()) ?? "other";
}

export function regionLabel(id: RegionId): string {
  return REGIONS.find((r) => r.id === id)?.label ?? "Elsewhere";
}
