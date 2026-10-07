import { it } from "vitest";
import { computeHash, computeHashUInt8Array } from "../util.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nactual=${actual}\nexpected=${expected}`);
  }
}

it("computeHash returns stable SHA-256 hex for bytes and text chunks", async () => {
  const expected =
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  assertEquals(
    await computeHashUInt8Array(new TextEncoder().encode("hello")),
    expected,
    "byte hash should match SHA-256",
  );
  assertEquals(
    await computeHash(["hello"]),
    expected,
    "text chunk hash should match SHA-256",
  );
});

it("computeHash accepts the ArrayBuffer-backed bytes used by file data", async () => {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(5));
  bytes.set(new TextEncoder().encode("hello"));

  assertEquals(
    await computeHash(bytes),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "ArrayBuffer-backed byte hash should match SHA-256",
  );
});
