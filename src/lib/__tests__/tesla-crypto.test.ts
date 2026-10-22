import { describe, expect, it } from "vitest";
import { aes128CbcDecryptNoPad, md5 } from "@/lib/tesla-crypto";
import {
  isEncryptedTeslaContainer,
  parseTeslaHeader,
} from "@/lib/tesla-decrypt";

/**
 * Known-answer tests for the crypto primitives that the encrypted-clip feature
 * depends on.
 *
 * This code was imported from upstream. Upstream's source comments say the
 * primitives are "verified vs test vectors"; these tests make that claim
 * executable, so a toolchain change that silently broke the crypto path could
 * not pass unnoticed.
 */

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const bytes = (h: string) =>
  new Uint8Array(h.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)));

describe("md5", () => {
  // RFC 1321, appendix A.5.
  const vectors: Array<[string, string]> = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  for (const [input, expected] of vectors) {
    it(`hashes ${JSON.stringify(input.slice(0, 24))}${input.length > 24 ? "…" : ""}`, () => {
      const digest = md5(new TextEncoder().encode(input));
      expect(digest).toHaveLength(16);
      expect(hex(digest)).toBe(expected);
    });
  }

  it("handles input spanning multiple 64-byte blocks", () => {
    // 1000 bytes of 0x61 ("a") — exercises the block loop and the length
    // padding for a message that is not a multiple of the block size.
    const digest = md5(new Uint8Array(1000).fill(0x61));
    expect(digest).toHaveLength(16);
    // Stable, cross-checked against Python's hashlib.md5 on the same input.
    expect(hex(digest)).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
  });
});

describe("aes128CbcDecryptNoPad", () => {
  // NIST SP 800-38A, F.2.1 (CBC-AES128.Decrypt), first two blocks.
  const key = bytes("2b7e151628aed2a6abf7158809cf4f3c");
  const iv = bytes("000102030405060708090a0b0c0d0e0f");
  const ciphertext = bytes(
    "7649abac8119b246cee98e9b12e9197d" + "5086cb9b507219ee95db113a917678b2",
  );
  const expected = bytes(
    "6bc1bee22e409f96e93d7e117393172a" + "ae2d8a571e03ac9c9eb76fac45af8e51",
  );

  it("decrypts the NIST CBC-AES128 vector", () => {
    const out = new Uint8Array(ciphertext.length);
    const written = aes128CbcDecryptNoPad(ciphertext, key, iv, out, 0);

    expect(written).toBe(ciphertext.length);
    expect(hex(out)).toBe(hex(expected));
  });

  it("writes at the requested output offset and leaves the prefix alone", () => {
    const out = new Uint8Array(ciphertext.length + 8).fill(0xaa);
    aes128CbcDecryptNoPad(ciphertext, key, iv, out, 8);

    expect(hex(out.subarray(0, 8))).toBe("aaaaaaaaaaaaaaaa");
    expect(hex(out.subarray(8))).toBe(hex(expected));
  });

  it("rejects a ciphertext that is not a whole number of blocks", () => {
    const out = new Uint8Array(32);
    expect(() =>
      aes128CbcDecryptNoPad(new Uint8Array(17), key, iv, out, 0),
    ).toThrow(/not a multiple of 16 bytes/);
  });
});

/**
 * Build a synthetic Tesla encrypted container header.
 *
 * Layout (all offsets from the start of the file):
 *   0x0000  u64  plaintext size
 *   0x0014  u32  metadata offset marker (0x1000)
 *   0x1000  u32  key id
 *   0x1004  65   EC public key (uncompressed, leading 0x04)
 *   0x1045  17   VIN
 *   0x1056  u64  timestamp
 *   0x105e  44   wrapped key
 *   0x2000  ...  ciphertext
 */
function makeEncryptedContainer(overrides: {
  plaintextSize?: number;
  keyId?: number;
  publicKeyPrefix?: number;
} = {}): Uint8Array {
  const { plaintextSize = 4096, keyId = 12345, publicKeyPrefix = 0x04 } = overrides;
  const buf = new Uint8Array(0x2000 + 32);
  const view = new DataView(buf.buffer);

  view.setUint32(0, 0); // high half of the u64 size
  view.setUint32(4, plaintextSize); // low half
  view.setUint32(0x14, 0x1000); // metadata offset marker
  view.setUint32(0x1000, keyId);

  buf[0x1004] = publicKeyPrefix;
  for (let i = 1; i < 65; i++) buf[0x1004 + i] = i & 0xff;

  const vin = "5YJ3E1EA7KF000001";
  for (let i = 0; i < 17; i++) buf[0x1045 + i] = vin.charCodeAt(i);

  view.setUint32(0x1056, 0);
  view.setUint32(0x105a, 1700000000); // timestamp low half

  for (let i = 0; i < 44; i++) buf[0x105e + i] = 0x10 + i;

  return buf;
}

describe("isEncryptedTeslaContainer", () => {
  it("accepts a well-formed synthetic container", () => {
    expect(isEncryptedTeslaContainer(makeEncryptedContainer())).toBe(true);
  });

  it("rejects a plain MP4", () => {
    // A minimal MP4 begins with a big-endian box size and "ftyp".
    const mp4 = new Uint8Array(0x2000 + 32);
    new DataView(mp4.buffer).setUint32(0, 24);
    mp4.set(new TextEncoder().encode("ftyp"), 4);

    expect(isEncryptedTeslaContainer(mp4)).toBe(false);
  });

  it("rejects a buffer shorter than the metadata offset", () => {
    expect(isEncryptedTeslaContainer(new Uint8Array(0x1000))).toBe(false);
  });

  it("rejects a container whose key id is zero", () => {
    expect(isEncryptedTeslaContainer(makeEncryptedContainer({ keyId: 0 }))).toBe(false);
  });

  it("rejects a container whose public key lacks the uncompressed marker", () => {
    expect(
      isEncryptedTeslaContainer(makeEncryptedContainer({ publicKeyPrefix: 0x05 })),
    ).toBe(false);
  });

  it("rejects a container with a zero plaintext size", () => {
    expect(
      isEncryptedTeslaContainer(makeEncryptedContainer({ plaintextSize: 0 })),
    ).toBe(false);
  });
});

describe("parseTeslaHeader", () => {
  it("extracts the header fields the key request needs", () => {
    const header = parseTeslaHeader(makeEncryptedContainer());

    expect(header.plaintextSize).toBe(4096);
    expect(header.keyId).toBe(12345);
    expect(header.vin).toBe("5YJ3E1EA7KF000001");
    expect(header.timestamp).toBe(1700000000);
    // id is a formatted UUID derived from the 16 bytes at 0x04.
    expect(header.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(header.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(header.wrappedKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("throws for a buffer too short to hold the header", () => {
    expect(() => parseTeslaHeader(new Uint8Array(64))).toThrow(/too short/i);
  });

  it("throws when the plaintext size is zero", () => {
    expect(() =>
      parseTeslaHeader(makeEncryptedContainer({ plaintextSize: 0 })),
    ).toThrow(/Invalid plaintext size/i);
  });
});
