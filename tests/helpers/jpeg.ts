/**
 * Builds a minimal JPEG whose EXIF block carries GPS coordinates, for tests. The bytes are a real container: a SOI
 * marker, one APP1 (Exif) segment with a little-endian TIFF structure, and an EOI marker. No pixels are encoded.
 */
export function jpegWithGps(options: { latitude: [number, number, number]; latSign: 'N' | 'S'; longitude: [number, number, number]; lngSign: 'E' | 'W' }): Uint8Array {
  const tiff = new Uint8Array(128);
  const view = new DataView(tiff.buffer);
  // TIFF header, little-endian, IFD0 at offset 8.
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 0x2a, true);
  view.setUint32(4, 8, true);
  // IFD0 at 8: one entry, the GPS pointer (0x8825) to the GPS IFD at 26.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  // GPS IFD at 26: four entries.
  view.setUint16(26, 4, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  };
  entry(28, 1, 2, 2, 0);
  tiff[36] = options.latSign.charCodeAt(0);
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 0);
  tiff[60] = options.lngSign.charCodeAt(0);
  entry(64, 4, 5, 3, 104);
  view.setUint32(76, 0, true);
  // Rational values: degrees, minutes, seconds, each as numerator and denominator.
  const writeDms = (at: number, [d, m, s]: [number, number, number]) => {
    view.setUint32(at, d, true);
    view.setUint32(at + 4, 1, true);
    view.setUint32(at + 8, m, true);
    view.setUint32(at + 12, 1, true);
    view.setUint32(at + 16, s, true);
    view.setUint32(at + 20, 1, true);
  };
  writeDms(80, options.latitude);
  writeDms(104, options.longitude);

  const header = new TextEncoder().encode('Exif\0\0');
  const segmentLength = 2 + header.length + tiff.length;
  const out = new Uint8Array(2 + 2 + 2 + header.length + tiff.length + 2);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe1;
  out[4] = (segmentLength >> 8) & 0xff;
  out[5] = segmentLength & 0xff;
  out.set(header, 6);
  out.set(tiff, 6 + header.length);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

/** A JPEG with no EXIF block at all: a valid start, no location. */
export function jpegWithoutLocation(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}
