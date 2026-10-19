import type { CheckPlace } from "../src/constraints.js";

/** Small hand-made places around central Lisbon (coordinates approximate). */
export const PLACES: Record<string, CheckPlace> = {
  jeronimos: {
    id: "jeronimos",
    name: "Jerónimos Monastery",
    category: "religious",
    lat: 38.6979,
    lon: -9.2063,
    hoursRaw: "Tu-Su 09:30-18:00",
  },
  belem: { id: "belem", name: "Belém Tower", category: "monument", lat: 38.6916, lon: -9.216, hoursRaw: "Tu-Su 09:30-18:00" },
  castle: {
    id: "castle",
    name: "São Jorge Castle",
    category: "castle",
    lat: 38.7139,
    lon: -9.1335,
    hoursRaw: "Mo-Su 09:00-21:00",
  },
  se: { id: "se", name: "Lisbon Cathedral", category: "religious", lat: 38.7099, lon: -9.1334, hoursRaw: "Mo-Sa 09:30-19:00" },
  miradouro: {
    id: "miradouro",
    name: "Miradouro de Santa Luzia",
    category: "viewpoint",
    lat: 38.7118,
    lon: -9.1302,
    hoursRaw: null,
  },
  gulbenkian: {
    id: "gulbenkian",
    name: "Calouste Gulbenkian Museum",
    category: "museum",
    lat: 38.7375,
    lon: -9.1545,
    hoursRaw: "Mo,We-Su 10:00-18:00",
  },
};

export const placeMap = () => new Map(Object.values(PLACES).map((p) => [p.id, p]));
