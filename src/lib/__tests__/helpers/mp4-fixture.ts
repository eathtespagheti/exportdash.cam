/**
 * Synthetic MP4 fixture builder.
 *
 * The dashcam parser walks real box structures, so the fixtures have to be
 * real box structures. The offsets the parser relies on are:
 *
 *   stsd  -> +8  (version/flags + entry count) then the avc1 box
 *   avc1  -> +24 width, +26 height, +78 first child box
 *   avcC  -> +1/+2/+3 profile/compat/level, +6 SPS length, then SPS, PPS
 *   mdhd  -> +0 version, +12 timescale (version 0)
 *   stts  -> +4 entry count, +8 first entry
 */

export function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Build an ISO BMFF box: 4-byte size + 4-byte type + payload. */
export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

export function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

/** mdhd with version 0 and the given timescale. */
function makeMdhd(timescale: number): Uint8Array {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 0); // creation_time
  view.setUint32(8, 0); // modification_time
  view.setUint32(12, timescale); // timescale
  view.setUint32(16, 1000); // duration
  return box("mdhd", payload);
}

/** stts with a single run of `count` samples each lasting `delta` ticks. */
function makeStts(count: number, delta: number): Uint8Array {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 1); // entry_count
  view.setUint32(8, count); // sample_count
  view.setUint32(12, delta); // sample_delta
  return box("stts", payload);
}

/** avcC carrying one SPS and one PPS. */
function makeAvcC(profile = 0x64, compat = 0x00, level = 0x28): Uint8Array {
  const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28]);
  const pps = new Uint8Array([0x68, 0xee, 0x3c, 0x80]);
  const payload = concat([
    new Uint8Array([
      0x01, // configurationVersion
      profile,
      compat,
      level,
      0xff, // lengthSizeMinusOne
      0xe1, // numOfSequenceParameterSets
    ]),
    u16(sps.length),
    sps,
    new Uint8Array([0x01]), // numOfPictureParameterSets
    u16(pps.length),
    pps,
  ]);
  return box("avcC", payload);
}

/** avc1 sample entry: 78 bytes of VisualSampleEntry, then the child boxes. */
function makeAvc1(width: number, height: number, avcC: Uint8Array): Uint8Array {
  const visual = new Uint8Array(78);
  const view = new DataView(visual.buffer);
  view.setUint16(2, 1); // data_reference_index
  view.setUint16(24, width); // width
  view.setUint16(26, height); // height
  return box("avc1", visual, avcC);
}

function makeStsd(avc1: Uint8Array): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 1); // entry_count
  return box("stsd", payload, avc1);
}

export interface Mp4Options {
  width?: number;
  height?: number;
  timescale?: number;
  sampleCount?: number;
  sampleDelta?: number;
  mdatPayload?: Uint8Array;
  profile?: number;
  compat?: number;
  level?: number;
}

/** Build a complete, minimal but structurally valid MP4. */
export function makeMp4(options: Mp4Options = {}): ArrayBuffer {
  const {
    width = 1920,
    height = 1080,
    timescale = 1000,
    sampleCount = 3,
    sampleDelta = 33,
    mdatPayload = new Uint8Array(0),
    profile = 0x64,
    compat = 0x00,
    level = 0x28,
  } = options;

  const avcC = makeAvcC(profile, compat, level);
  const avc1 = makeAvc1(width, height, avcC);
  const stsd = makeStsd(avc1);
  const stts = makeStts(sampleCount, sampleDelta);
  const stbl = box("stbl", stsd, stts);
  const minf = box("minf", stbl);
  const mdhd = makeMdhd(timescale);
  const mdia = box("mdia", mdhd, minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const mdat = box("mdat", mdatPayload);
  const ftyp = box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d]));

  return concat([ftyp, moov, mdat]).buffer as ArrayBuffer;
}

/** Build a length-prefixed NAL unit. */
export function nal(type: number, payload: Uint8Array[]): Uint8Array {
  const body = concat([new Uint8Array([type & 0x1f]), ...payload]);
  return concat([u32(body.length), body]);
}

/**
 * A Tesla SEI NAL unit:
 *   [0] 0x06 nal type (SEI)
 *   [1] 0x05 payload type (user_data_unregistered)
 *   [2] 0xff payload size
 *   [3..] 0x42 padding
 *   then 0x69 marker
 *   then the protobuf payload
 *   then one trailing byte
 */
export function seiNal(protobufPayload: Uint8Array, padding = 2): Uint8Array {
  const paddingBytes = new Uint8Array(padding).fill(0x42);
  const body = concat([
    new Uint8Array([0x06, 0x05, 0xff]),
    paddingBytes,
    new Uint8Array([0x69]),
    protobufPayload,
    new Uint8Array([0x80]), // trailing byte, stripped by the parser
  ]);
  return concat([u32(body.length), body]);
}
