'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';
import { postForm, postJson, formatUtc, type Outcome } from './api';
import type { PlaceImport } from '@/domain/product';
import { jpegMetadataOnly } from '@/domain/places/capture';
import type { PlaceListing } from '@/services/places';
import type { CapturePreview, CaptureCandidate } from '@/services/place-capture';

/**
 * Capture: finds places in text, a link, an import file or a photo's location, shows what was found, and saves only
 * the candidates the person ticks. Nothing is saved on preview. Every candidate shows where it came from.
 */

type Mode = 'TEXT' | 'LINK' | 'IMPORT' | 'PHOTO';

const MODES: Array<{ id: Mode; label: string; help: string }> = [
  { id: 'TEXT', label: 'From text', help: 'Paste a message or a plan. HELLO looks for places it already knows in it.' },
  { id: 'LINK', label: 'From a link', help: 'Paste a Google Maps place link. HELLO reads the name and position from the link and does not open it.' },
  { id: 'IMPORT', label: 'Import a file', help: 'Choose a Google Takeout saved-places file (CSV or GeoJSON). Each row is checked. Nothing is saved until you choose.' },
  { id: 'PHOTO', label: 'From a photo', help: 'Choose a JPEG. Only the location the camera recorded is sent to HELLO; the picture itself never leaves your device.' },
];

interface Props {
  eventId: string;
  listing: PlaceListing;
}

interface SaveSummary {
  saved: number;
  skipped: Array<{ name: string; reason: string }>;
}

export function PlaceCapture({ eventId, listing }: Props) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [mode, setMode] = useState<Mode>('TEXT');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [importSource, setImportSource] = useState<{ fileName: string; format: 'CSV' | 'GEOJSON' } | null>(null);

  function reset(next: Mode) {
    setMode(next);
    setPreview(null);
    setPicked({});
    setDraftNames({});
    setSummary(null);
    setFile(null);
  }

  function takePreview(result: CapturePreview) {
    setPreview(result);
    setSummary(null);
    const initial: Record<string, boolean> = {};
    for (const candidate of result.candidates) initial[candidate.key] = candidate.duplicateOf === null;
    setPicked(initial);
    setDraftNames({});
  }

  async function look() {
    setSummary(null);
    setBusy(true);
    try {
      let outcome: Outcome<CapturePreview>;
      if (mode === 'TEXT') {
        outcome = await postJson<CapturePreview>(`/api/events/${eventId}/places/capture`, { kind: 'TEXT', text });
      } else if (mode === 'LINK') {
        outcome = await postJson<CapturePreview>(`/api/events/${eventId}/places/capture`, { kind: 'LINK', url, name: linkName.trim() || null });
      } else if (mode === 'IMPORT') {
        if (!file) {
          toast('error', 'Choose a file first.');
          return;
        }
        const content = await file.text();
        outcome = await postJson<CapturePreview>(`/api/events/${eventId}/places/capture`, { kind: 'IMPORT', fileName: file.name, content });
        if (outcome.ok) setImportSource({ fileName: file.name, format: outcome.data.format ?? 'CSV' });
      } else {
        if (!file) {
          toast('error', 'Choose a photo first.');
          return;
        }
        // Only the photo's EXIF block is sent: the picture itself never leaves this device.
        const metadata = jpegMetadataOnly(new Uint8Array(await file.arrayBuffer()));
        const form = new FormData();
        form.append('photo', new File([metadata.slice().buffer], file.name, { type: 'image/jpeg' }));
        outcome = await postForm<CapturePreview>(`/api/events/${eventId}/places/capture/photo`, form);
      }
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      takePreview(outcome.data);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    const chosen: CaptureCandidate[] = preview.candidates.filter((c) => picked[c.key] && c.duplicateOf === null);
    if (chosen.length === 0) {
      toast('error', 'Tick at least one place that is not already saved.');
      return;
    }
    const candidates = chosen.map((c) => ({
      name: (draftNames[c.key] ?? c.name).trim(),
      note: c.note,
      address: c.address,
      latitude: c.latitude,
      longitude: c.longitude,
      spaceId: c.spaceId,
      tags: c.tags,
    }));
    const body =
      mode === 'TEXT'
        ? { kind: 'TEXT', candidates }
        : mode === 'LINK'
          ? { kind: 'LINK', host: safeHost(url), candidates }
          : mode === 'PHOTO'
            ? { kind: 'PHOTO', candidates }
            : {
                kind: 'IMPORT',
                fileName: importSource?.fileName ?? 'import',
                format: importSource?.format ?? 'CSV',
                total: preview.candidates.length,
                failures: preview.failures,
                candidates,
              };
    setBusy(true);
    try {
      const outcome = await postJson<{ saved: unknown[]; skipped: Array<{ name: string; reason: string }> }>(`/api/events/${eventId}/places/capture/save`, body);
      if (!outcome.ok) {
        toast('error', outcome.message);
        return;
      }
      setSummary({ saved: outcome.data.saved.length, skipped: outcome.data.skipped });
      toast('success', `${outcome.data.saved.length} place${outcome.data.saved.length === 1 ? '' : 's'} saved to My places.`);
      setPreview(null);
      setPicked({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = MODES.find((m) => m.id === mode);

  return (
    <section className="card" aria-labelledby="capture">
      <div className="card__body stack">
        <h2 id="capture">Add places from something you have</h2>
        <div className="row" role="tablist" aria-label="Where the place comes from">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className="button button--ghost" onClick={() => { reset(m.id); }}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="small muted">{active?.help}</p>

        {mode === 'TEXT' ? (
          <label className="field">
            <span>Text to look in</span>
            <textarea rows={3} maxLength={4000} value={text} onChange={(event) => { setText(event.target.value); }} placeholder="e.g. Let’s meet at the Atrium after 5" />
          </label>
        ) : null}

        {mode === 'LINK' ? (
          <div className="stack">
            <label className="field">
              <span>Google Maps place link</span>
              <input type="url" value={url} maxLength={2000} onChange={(event) => { setUrl(event.target.value); }} placeholder="https://www.google.com/maps/place/…" />
            </label>
            <label className="field">
              <span>Name, if the link has none (optional)</span>
              <input value={linkName} maxLength={80} onChange={(event) => { setLinkName(event.target.value); }} />
            </label>
          </div>
        ) : null}

        {mode === 'IMPORT' ? (
          <label className="field">
            <span>Saved-places file (.csv or .json)</span>
            <input type="file" accept=".csv,.json,application/json,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); }} />
          </label>
        ) : null}

        {mode === 'PHOTO' ? (
          <label className="field">
            <span>JPEG photo</span>
            <input type="file" accept="image/jpeg" onChange={(event) => { setFile(event.target.files?.[0] ?? null); }} />
          </label>
        ) : null}

        <div className="row">
          <button type="button" className="button" disabled={busy} onClick={() => void look()}>
            {busy ? 'Looking…' : 'Look for places'}
          </button>
        </div>

        {preview ? (
          <div className="stack" aria-live="polite">
            <p className="small">{preview.message}</p>
            {preview.timeHints.length > 0 ? (
              <p className="small faint">Time mentioned in the text, for you to check: {preview.timeHints.join(', ')}. HELLO does not save times.</p>
            ) : null}
            {preview.failures.length > 0 ? (
              <details>
                <summary className="small">
                  {preview.failures.length} row{preview.failures.length === 1 ? '' : 's'} could not be read
                </summary>
                <ul className="small list-reset">
                  {preview.failures.map((failure) => (
                    <li key={`${failure.line}-${failure.reason}`}>
                      Line {failure.line}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {preview.candidates.length > 0 ? (
              <ul className="stack list-reset">
                {preview.candidates.map((candidate) => (
                  <li key={candidate.key} className="card">
                    <div className="card__body stack">
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={picked[candidate.key] ?? false}
                          disabled={candidate.duplicateOf !== null}
                          onChange={(event) => { setPicked((state) => ({ ...state, [candidate.key]: event.target.checked })); }}
                          aria-label={`Save ${candidate.name}`}
                        />
                        <input
                          aria-label="Name"
                          value={draftNames[candidate.key] ?? candidate.name}
                          maxLength={80}
                          onChange={(event) => { setDraftNames((state) => ({ ...state, [candidate.key]: event.target.value })); }}
                        />
                      </label>
                      <p className="small faint">{candidate.sourceLabel}</p>
                      {candidate.latitude !== null && candidate.longitude !== null ? (
                        <p className="small faint">
                          Position: {candidate.latitude}, {candidate.longitude}
                        </p>
                      ) : null}
                      {candidate.duplicateOf !== null ? <span className="badge">Already in My places</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.candidates.length > 0 ? (
              <div className="row">
                <button type="button" className="button" disabled={busy} onClick={() => void save()}>
                  Save selected places
                </button>
                <button type="button" className="button button--ghost" onClick={() => { setPreview(null); }}>
                  Discard
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {summary ? (
          <div className="stack" aria-live="polite">
            <p className="small">
              Saved {summary.saved} place{summary.saved === 1 ? '' : 's'}.
              {summary.skipped.length > 0 ? ` ${summary.skipped.length} not saved:` : ''}
            </p>
            {summary.skipped.length > 0 ? (
              <ul className="small list-reset">
                {summary.skipped.map((item, index) => (
                  <li key={`${item.name}-${index}`}>
                    {item.name}: {item.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="stack">
          <h3>Import history</h3>
          {listing.imports.length === 0 ? (
            <p className="small faint">No file has been imported yet.</p>
          ) : (
            <ul className="stack list-reset">
              {listing.imports.map((batch) => (
                <ImportRow key={batch.id} batch={batch} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ImportRow({ batch }: { batch: PlaceImport }) {
  return (
    <li className="card">
      <div className="card__body stack">
        <strong>{batch.fileName}</strong>
        <p className="small muted">
          {batch.format} · read {batch.total} · saved {batch.saved} · not saved {batch.skipped} · {formatUtc(batch.createdAt)}
        </p>
        {batch.failures.length > 0 ? (
          <details>
            <summary className="small">
              {batch.failures.length} row{batch.failures.length === 1 ? '' : 's'} could not be read
            </summary>
            <ul className="small list-reset">
              {batch.failures.map((failure) => (
                <li key={`${failure.line}-${failure.reason}`}>
                  Line {failure.line}: {failure.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}
