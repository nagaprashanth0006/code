/**
 * ULID generation (https://github.com/ulid/spec): 48-bit millisecond timestamp
 * plus 80 random bits, Crockford base32. Sortable by creation time and safe to
 * merge across devices, which is why every primary key uses it.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function defaultRandom(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function ulid(now: number = Date.now(), random: (n: number) => Uint8Array = defaultRandom): string {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1) {
    throw new RangeError(`ULID timestamp out of range: ${now}`);
  }
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 16 random chars x 5 bits = 80 bits; take the low 5 bits of 16 random bytes.
  const bytes = random(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ENCODING[(bytes[i] ?? 0) & 31];
  return time + rand;
}

export function ulidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) {
    const v = ENCODING.indexOf(ch);
    if (v < 0) throw new Error(`Invalid ULID: ${id}`);
    t = t * 32 + v;
  }
  return t;
}
