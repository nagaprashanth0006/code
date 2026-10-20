/**
 * The hand-curated destination list behind the landing hub. Edit this, then
 * run `npm run ingest -- destinations` to refresh core/src/data/destinations.json
 * and the photos in app/public/destinations.
 *
 *   name   shown in the app
 *   cc     ISO 3166-1 alpha-2 country code
 *   themes strongest first; drives the landing rows
 *   query  the city to fetch places for (default: name); a region uses its main town
 *   wiki   English Wikipedia title for the summary and photo (default: name)
 *   photo  a Commons file to use when Wikidata's image is missing or a map
 */
import type { Theme } from "@itinera/core";

export interface DestinationSeed {
  name: string;
  cc: string;
  themes: Theme[];
  query?: string;
  wiki?: string;
  photo?: string;
}

export const DESTINATION_SEEDS: DestinationSeed[] = [
  // India
  { name: "Goa", cc: "IN", themes: ["romantic", "nature", "solo"], query: "Panaji" },
  { name: "Jaipur", cc: "IN", themes: ["historical", "culture", "romantic"] },
  { name: "Udaipur", cc: "IN", themes: ["romantic", "historical", "culture"] },
  { name: "Jodhpur", cc: "IN", themes: ["historical", "culture"] },
  { name: "Jaisalmer", cc: "IN", themes: ["adventure", "historical", "romantic"] },
  { name: "Agra", cc: "IN", themes: ["historical", "culture", "romantic"] },
  { name: "Varanasi", cc: "IN", themes: ["culture", "historical", "solo"] },
  { name: "Rishikesh", cc: "IN", themes: ["adventure", "solo", "nature"] },
  { name: "Leh", cc: "IN", themes: ["adventure", "nature", "solo"] },
  { name: "Manali", cc: "IN", themes: ["adventure", "nature", "romantic"], wiki: "Manali, Himachal Pradesh" },
  { name: "Shimla", cc: "IN", themes: ["nature", "romantic", "historical"] },
  { name: "Darjeeling", cc: "IN", themes: ["nature", "romantic", "culture"] },
  { name: "Gangtok", cc: "IN", themes: ["nature", "adventure", "culture"] },
  { name: "Srinagar", cc: "IN", themes: ["romantic", "nature"] },
  { name: "Amritsar", cc: "IN", themes: ["culture", "historical"] },
  { name: "Delhi", cc: "IN", themes: ["historical", "culture"] },
  { name: "Mumbai", cc: "IN", themes: ["culture", "solo"] },
  { name: "Kolkata", cc: "IN", themes: ["culture", "historical"] },
  { name: "Hyderabad", cc: "IN", themes: ["historical", "culture"] },
  { name: "Kochi", cc: "IN", themes: ["culture", "historical", "romantic"] },
  { name: "Munnar", cc: "IN", themes: ["nature", "romantic"] },
  { name: "Alappuzha", cc: "IN", themes: ["romantic", "nature"] },
  { name: "Mysuru", cc: "IN", themes: ["historical", "culture"], wiki: "Mysore" },
  { name: "Hampi", cc: "IN", themes: ["historical", "adventure", "solo"] },
  { name: "Puducherry", cc: "IN", themes: ["romantic", "culture", "solo"], wiki: "Pondicherry" },
  { name: "Ooty", cc: "IN", themes: ["nature", "romantic"], query: "Udhagamandalam" },
  { name: "Coorg", cc: "IN", themes: ["nature", "romantic", "adventure"], query: "Madikeri", wiki: "Kodagu district" },
  { name: "Gokarna", cc: "IN", themes: ["nature", "solo", "romantic"], wiki: "Gokarna, Karnataka" },
  { name: "Andaman Islands", cc: "IN", themes: ["nature", "adventure", "romantic"], query: "Port Blair" },
  // South and Southeast Asia
  { name: "Kathmandu", cc: "NP", themes: ["culture", "historical", "adventure"] },
  { name: "Pokhara", cc: "NP", themes: ["adventure", "nature", "solo"] },
  { name: "Thimphu", cc: "BT", themes: ["culture", "nature"] },
  { name: "Colombo", cc: "LK", themes: ["culture", "solo"] },
  { name: "Kandy", cc: "LK", themes: ["culture", "historical", "nature"] },
  { name: "Galle", cc: "LK", themes: ["historical", "romantic", "nature"] },
  { name: "Maldives", cc: "MV", themes: ["romantic", "nature"], query: "Malé", photo: "Maldives island beach 1.jpg" },
  { name: "Bangkok", cc: "TH", themes: ["culture", "solo"] },
  { name: "Chiang Mai", cc: "TH", themes: ["culture", "solo", "nature"] },
  { name: "Phuket", cc: "TH", themes: ["romantic", "nature"], query: "Phuket City", wiki: "Phuket province" },
  { name: "Krabi", cc: "TH", themes: ["adventure", "nature", "romantic"], wiki: "Krabi province" },
  { name: "Bali", cc: "ID", themes: ["romantic", "nature", "culture"], query: "Denpasar" },
  { name: "Singapore", cc: "SG", themes: ["culture", "solo"] },
  { name: "Kuala Lumpur", cc: "MY", themes: ["culture", "solo"] },
  { name: "Langkawi", cc: "MY", themes: ["nature", "romantic"] },
  { name: "Hanoi", cc: "VN", themes: ["culture", "historical", "solo"] },
  { name: "Ha Long Bay", cc: "VN", themes: ["nature", "adventure", "romantic"], query: "Hạ Long" },
  {
    name: "Hoi An",
    cc: "VN",
    themes: ["romantic", "historical", "culture"],
    query: "Hội An",
    photo: "Hội An, Ancient Town, 2020-01 CN-01.jpg",
  },
  { name: "Ho Chi Minh City", cc: "VN", themes: ["culture", "solo"] },
  { name: "Siem Reap", cc: "KH", themes: ["historical", "culture", "adventure"] },
  { name: "Luang Prabang", cc: "LA", themes: ["culture", "historical", "solo"] },
  // East Asia
  { name: "Tokyo", cc: "JP", themes: ["culture", "solo"] },
  { name: "Kyoto", cc: "JP", themes: ["historical", "culture", "romantic"] },
  { name: "Osaka", cc: "JP", themes: ["culture", "solo"] },
  { name: "Seoul", cc: "KR", themes: ["culture", "solo"] },
  { name: "Busan", cc: "KR", themes: ["nature", "culture"] },
  { name: "Hong Kong", cc: "HK", themes: ["culture", "solo", "nature"] },
  { name: "Taipei", cc: "TW", themes: ["culture", "solo"] },
  // Central Asia, Middle East and Africa
  { name: "Almaty", cc: "KZ", themes: ["nature", "adventure"] },
  { name: "Tbilisi", cc: "GE", themes: ["culture", "historical", "solo"] },
  { name: "Dubai", cc: "AE", themes: ["solo", "adventure", "romantic"] },
  { name: "Abu Dhabi", cc: "AE", themes: ["culture"] },
  { name: "Muscat", cc: "OM", themes: ["culture", "nature"] },
  { name: "Istanbul", cc: "TR", themes: ["historical", "culture", "romantic"] },
  { name: "Cappadocia", cc: "TR", themes: ["romantic", "adventure", "historical"], query: "Nevşehir" },
  { name: "Petra", cc: "JO", themes: ["historical", "adventure"], query: "Wadi Musa" },
  { name: "Cairo", cc: "EG", themes: ["historical", "culture"] },
  { name: "Luxor", cc: "EG", themes: ["historical"] },
  { name: "Marrakesh", cc: "MA", themes: ["culture", "historical", "romantic"] },
  { name: "Cape Town", cc: "ZA", themes: ["nature", "adventure", "romantic"] },
  {
    name: "Zanzibar",
    cc: "TZ",
    themes: ["romantic", "nature"],
    query: "Zanzibar City",
    photo: "Sail Boat Sunset Stone Town Zanzibar Oct26 OM3 1123.jpg",
  },
  { name: "Nairobi", cc: "KE", themes: ["adventure", "nature"] },
  { name: "Mauritius", cc: "MU", themes: ["romantic", "nature"], query: "Port Louis" },
  // Europe
  { name: "Lisbon", cc: "PT", themes: ["romantic", "historical", "culture"] },
  { name: "Porto", cc: "PT", themes: ["romantic", "culture", "historical"] },
  { name: "Seville", cc: "ES", themes: ["romantic", "historical", "culture"] },
  { name: "Granada", cc: "ES", themes: ["historical", "romantic"] },
  { name: "Barcelona", cc: "ES", themes: ["culture", "romantic", "solo"] },
  { name: "Madrid", cc: "ES", themes: ["culture", "solo"] },
  { name: "Paris", cc: "FR", themes: ["romantic", "culture", "historical"] },
  { name: "Nice", cc: "FR", themes: ["romantic", "nature"] },
  { name: "Rome", cc: "IT", themes: ["historical", "culture", "romantic"] },
  { name: "Florence", cc: "IT", themes: ["culture", "historical", "romantic"] },
  { name: "Venice", cc: "IT", themes: ["romantic", "historical"] },
  { name: "Amalfi Coast", cc: "IT", themes: ["romantic", "nature"], query: "Amalfi" },
  { name: "Santorini", cc: "GR", themes: ["romantic", "nature"], query: "Thira" },
  { name: "Athens", cc: "GR", themes: ["historical", "culture"] },
  { name: "Dubrovnik", cc: "HR", themes: ["historical", "romantic"] },
  { name: "Prague", cc: "CZ", themes: ["romantic", "historical", "culture"] },
  { name: "Vienna", cc: "AT", themes: ["culture", "historical", "romantic"] },
  { name: "Budapest", cc: "HU", themes: ["romantic", "culture", "historical"] },
  { name: "Kraków", cc: "PL", themes: ["historical", "culture"] },
  { name: "Berlin", cc: "DE", themes: ["culture", "historical", "solo"] },
  { name: "Amsterdam", cc: "NL", themes: ["culture", "solo", "romantic"] },
  { name: "Copenhagen", cc: "DK", themes: ["culture", "solo"] },
  { name: "London", cc: "GB", themes: ["culture", "historical", "solo"] },
  { name: "Edinburgh", cc: "GB", themes: ["historical", "culture"] },
  { name: "Interlaken", cc: "CH", themes: ["adventure", "nature", "romantic"] },
  { name: "Zermatt", cc: "CH", themes: ["adventure", "nature", "romantic"] },
  { name: "Reykjavík", cc: "IS", themes: ["adventure", "nature"] },
  { name: "Tromsø", cc: "NO", themes: ["adventure", "nature"] },
  // Americas
  { name: "New York City", cc: "US", themes: ["culture", "solo"] },
  { name: "San Francisco", cc: "US", themes: ["culture", "nature"] },
  { name: "Vancouver", cc: "CA", themes: ["nature", "adventure"] },
  { name: "Banff", cc: "CA", themes: ["nature", "adventure", "romantic"], wiki: "Banff, Alberta" },
  { name: "Mexico City", cc: "MX", themes: ["culture", "historical"] },
  { name: "Cancún", cc: "MX", themes: ["romantic", "nature"] },
  { name: "Havana", cc: "CU", themes: ["culture", "historical", "romantic"] },
  { name: "Cusco", cc: "PE", themes: ["historical", "adventure", "culture"] },
  { name: "Rio de Janeiro", cc: "BR", themes: ["nature", "adventure", "culture"] },
  { name: "Buenos Aires", cc: "AR", themes: ["culture", "romantic"] },
  // Oceania
  { name: "Sydney", cc: "AU", themes: ["nature", "culture", "solo"] },
  { name: "Melbourne", cc: "AU", themes: ["culture", "solo"] },
  { name: "Queenstown", cc: "NZ", themes: ["adventure", "nature", "romantic"], wiki: "Queenstown, New Zealand" },
];
