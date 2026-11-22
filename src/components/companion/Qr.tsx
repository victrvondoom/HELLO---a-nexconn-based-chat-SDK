import qrcode from 'qrcode-generator';

/** A QR code drawn as inline SVG on the server: no image request, no third party. */
export function Qr({ value, label, size = 168 }: { value: string; label: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return <div className="qr" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
