'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';

type SignalData = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
interface Poll {
  ended: boolean;
  peers: Array<{ peerId: string; name: string; isSelf: boolean }>;
  signals: Array<{ seq: number; from: string; data: SignalData }>;
}
interface Joined {
  peerId: string;
  peers: string[];
  iceServers: RTCIceServer[];
}
interface Remote {
  peerId: string;
  name: string;
  stream: MediaStream;
}

function Tile({ stream, name, self, mirrored }: { stream: MediaStream | null; name: string; self: boolean; mirrored: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="call-tile">
      <Icon name="user" />
      {/* Your own tile is muted so you never hear yourself. */}
      <video ref={ref} autoPlay playsInline muted={self} className={mirrored ? 'is-mirrored' : undefined} aria-label={self ? 'Your camera' : `${name}’s video`} />
      <span className="call-tile__name">{self ? `${name} (you)` : name}</span>
    </div>
  );
}

/**
 * A call room. Each pair of people connects directly, browser to browser. The server only passes
 * the short setup messages between them (polled once a second) and never sees audio or video.
 */
export function CallRoom({ eventId, callId, title, isHost, myName }: { eventId: string; callId: string; title: string; isHost: boolean; myName: string }) {
  const url = `/api/events/${eventId}/calls/${callId}`;
  const { toast } = useFeedback();
  const [phase, setPhase] = useState<'lobby' | 'joining' | 'in' | 'ended'>('lobby');
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [direct, setDirect] = useState(false);

  const me = useRef<string | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const camera = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const streams = useRef(new Map<string, MediaStream>());
  const pending = useRef(new Map<string, RTCIceCandidateInit[]>());
  const names = useRef(new Map<string, string>());
  const since = useRef(0);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);

  const publish = useCallback(() => {
    setRemotes([...streams.current.entries()].map(([peerId, stream]) => ({ peerId, stream, name: names.current.get(peerId) ?? 'Joining…' })));
  }, []);

  const send = useCallback((to: string, data: SignalData) => api(url, 'POST', { action: 'signal', peerId: me.current, to, data }).catch(() => undefined), [url]);

  /** The track currently going out for a kind: the shared screen replaces the camera while sharing. */
  const outgoing = (kind: string): MediaStreamTrack | null => {
    if (kind === 'video' && screen.current) return screen.current.getVideoTracks()[0] ?? null;
    return camera.current?.getTracks().find((t) => t.kind === kind) ?? null;
  };

  const drop = useCallback(
    (peerId: string) => {
      pcs.current.get(peerId)?.close();
      pcs.current.delete(peerId);
      streams.current.delete(peerId);
      pending.current.delete(peerId);
      publish();
    },
    [publish],
  );

  const connect = useCallback(
    (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ice.current });
      pcs.current.set(peerId, pc);
      streams.current.set(peerId, new MediaStream());
      pc.onicecandidate = (e) => {
        if (e.candidate) void send(peerId, { type: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
      };
      pc.ontrack = (e) => {
        streams.current.get(peerId)?.addTrack(e.track);
        publish();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(peerId);
      };
      publish();
      return pc;
    },
    [drop, publish, send],
  );

  /** Both directions are opened for audio and video even with no camera, so a screen can be shared later without renegotiating. */
  const attach = async (pc: RTCPeerConnection) => {
    for (const t of pc.getTransceivers()) {
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(outgoing(t.receiver.track.kind));
    }
  };

  const handle = useCallback(
    async (from: string, data: SignalData) => {
      if (data.type === 'ice') {
        const candidate = { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex };
        const known = pcs.current.get(from);
        if (known?.remoteDescription) await known.addIceCandidate(candidate).catch(() => undefined);
        else pending.current.set(from, [...(pending.current.get(from) ?? []), candidate]);
        return;
      }
      if (data.type === 'offer') {
        const offered = pcs.current.get(from) ?? connect(from);
        await offered.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await attach(offered);
        const answer = await offered.createAnswer();
        await offered.setLocalDescription(answer);
        void send(from, { type: 'answer', sdp: answer.sdp ?? '' });
      } else {
        await pcs.current.get(from)?.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      }
      const pc = pcs.current.get(from);
      for (const c of pending.current.get(from) ?? []) await pc?.addIceCandidate(c).catch(() => undefined);
      pending.current.delete(from);
    },
    // attach reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connect, send],
  );

  const cleanup = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    for (const id of [...pcs.current.keys()]) drop(id);
    for (const s of [camera.current, screen.current]) s?.getTracks().forEach((t) => { t.stop(); });
    camera.current = null;
    screen.current = null;
    setLocal(null);
    setSharing(false);
  }, [drop]);

  const poll = useCallback(async () => {
    if (busy.current || !me.current) return;
    busy.current = true;
    try {
      const state = await api<Poll>(`${url}?peer=${me.current}&since=${since.current}`);
      if (state.ended) {
        cleanup();
        setPhase('ended');
        return;
      }
      const present = new Set(state.peers.map((p) => p.peerId));
      for (const p of state.peers) names.current.set(p.peerId, p.name);
      for (const id of [...pcs.current.keys()]) if (!present.has(id)) drop(id);
      for (const s of state.signals) {
        since.current = Math.max(since.current, s.seq);
        await handle(s.from, s.data).catch(() => undefined);
      }
      publish();
    } catch {
      /* a missed poll is retried a second later */
    } finally {
      busy.current = false;
    }
  }, [cleanup, drop, handle, publish, url]);

  async function join() {
    setPhase('joining');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 360 } });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setCam(false);
      } catch {
        setMic(false);
        setCam(false);
        toast('info', 'Joined without camera or microphone. You can still watch, listen and share your screen.');
      }
    }
    camera.current = stream;
    setLocal(stream);
    try {
      const joined = await api<Joined>(url, 'POST', { action: 'join' });
      me.current = joined.peerId;
      ice.current = joined.iceServers;
      setDirect(joined.iceServers.length === 0);
      since.current = 0;
      // The person joining calls everyone already there.
      for (const peerId of joined.peers) {
        const pc = connect(peerId);
        pc.addTransceiver('audio', { direction: 'sendrecv' });
        pc.addTransceiver('video', { direction: 'sendrecv' });
        await attach(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        void send(peerId, { type: 'offer', sdp: offer.sdp ?? '' });
      }
      timer.current = window.setInterval(() => void poll(), 1000);
      setPhase('in');
    } catch (e: unknown) {
      cleanup();
      setPhase('lobby');
      toast('error', errorText(e));
    }
  }

  const leave = useCallback(
    (endForAll: boolean) => {
      const peerId = me.current;
      me.current = null;
      cleanup();
      if (peerId) void fetch(url, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(endForAll ? { action: 'end' } : { action: 'leave', peerId }) }).catch(() => undefined);
    },
    [cleanup, url],
  );

  useEffect(() => {
    const onHide = () => { leave(false); };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      leave(false);
    };
  }, [leave]);

  async function replaceVideo() {
    for (const pc of pcs.current.values()) {
      for (const t of pc.getTransceivers()) if (t.receiver.track.kind === 'video') await t.sender.replaceTrack(outgoing('video'));
    }
  }

  async function toggleShare() {
    if (sharing) {
      screen.current?.getTracks().forEach((t) => { t.stop(); });
      screen.current = null;
      setSharing(false);
      setLocal(camera.current);
      await replaceVideo();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screen.current = display;
      const track = display.getVideoTracks()[0];
      if (track) track.onended = () => { if (screen.current === display) void toggleShareOff(); };
      setSharing(true);
      setLocal(display);
      await replaceVideo();
    } catch {
      /* the person closed the picker: nothing to do */
    }
  }
  async function toggleShareOff() {
    screen.current = null;
    setSharing(false);
    setLocal(camera.current);
    await replaceVideo();
  }

  const toggle = (kind: 'audio' | 'video') => {
    const next = kind === 'audio' ? !mic : !cam;
    camera.current?.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = next; });
    if (kind === 'audio') setMic(next);
    else setCam(next);
  };
  const has = (kind: string) => Boolean(camera.current?.getTracks().some((t) => t.kind === kind));

  if (phase === 'ended') {
    return (
      <div className="empty">
        <strong>This call has ended</strong>
        <p>
          <Link href={`/events/${eventId}/calls`}>Back to calls</Link>
        </p>
      </div>
    );
  }
  if (phase !== 'in') {
    return (
      <div className="panel panel__body stack" style={{ maxWidth: 520 }}>
        <h2 style={{ margin: 0 }}>Ready to join “{title}”?</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Your browser will ask for your camera and microphone. You can refuse and still join to watch and listen. Audio and video go directly between the people in the call; HELLO does not receive or record them.
        </p>
        <div>
          <button type="button" className="button" disabled={phase === 'joining'} onClick={() => void join()}>
            <Icon name="video" /> {phase === 'joining' ? 'Joining…' : 'Join call'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      {direct ? (
        <p className="notice" role="note" style={{ marginBottom: 12 }}>
          This server has no relay configured, so calls connect only between people on the same network.
        </p>
      ) : null}
      <div className="call-stage" aria-live="polite">
        <Tile stream={local} name={myName} self mirrored={!sharing} />
        {remotes.map((r) => (
          <Tile key={r.peerId} stream={r.stream} name={r.name} self={false} mirrored={false} />
        ))}
      </div>
      <div className="call-bar" role="toolbar" aria-label="Call controls">
        <button type="button" className="icon-button" aria-pressed={mic} disabled={!has('audio')} onClick={() => { toggle('audio'); }}>
          <Icon name="mic" /> {mic ? 'Mute' : 'Unmute'}
        </button>
        <button type="button" className="icon-button" aria-pressed={cam} disabled={!has('video')} onClick={() => { toggle('video'); }}>
          <Icon name="video" /> {cam ? 'Stop camera' : 'Start camera'}
        </button>
        <button type="button" className="icon-button" aria-pressed={sharing} onClick={() => void toggleShare()}>
          <Icon name="share" /> {sharing ? 'Stop sharing' : 'Share screen'}
        </button>
        <span className="xs faint" style={{ alignSelf: 'center' }}>
          {remotes.length + 1} in call
        </span>
        <button type="button" className="button button--ghost button--sm" onClick={() => { leave(false); setPhase('lobby'); }}>
          Leave
        </button>
        {isHost ? (
          <button type="button" className="button button--danger button--sm" onClick={() => { leave(true); setPhase('ended'); }}>
            End for everyone
          </button>
        ) : null}
      </div>
    </div>
  );
}
