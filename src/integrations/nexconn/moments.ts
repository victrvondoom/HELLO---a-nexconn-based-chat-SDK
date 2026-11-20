import type { Post, ReactionId, Story } from '../../domain/product';
import { extractTags } from '../../domain/moments/tags';

/**
 * How Moments map onto Nexconn messages. Pure: nothing here opens a connection and nothing is sent.
 * Nexconn is not connected in this build (see status.ts), so an envelope describes what would be sent;
 * the UI may show it as a mapping, never as a delivery.
 *
 * The shapes below are local copies of declarations in @nexconn/chat@26.5.1 (index.d.ts), limited to
 * what was checked there: the ChannelType values, CustomMessageRegistration, SendMessageParams'
 * `metadata` (string values only), `needReceipt` and `directedUserIds`, message reactions (`reactionId`,
 * up to 16 characters, since 26.5.0) and ReferenceMessageContent. The SDK is not a dependency of this
 * build, so a copy is the only honest way to type against it. Nothing else about Nexconn is assumed.
 */

/** ChannelType in @nexconn/chat@26.5.1. Community channels have sub-channels. */
export const NEXCONN_CHANNEL = { DIRECT: 1, GROUP: 3, OPEN: 4, SYSTEM: 6, COMMUNITY: 10 } as const;
/** AddMessageReactionParams.reactionId: "up to 16 characters". */
export const NEXCONN_REACTION_ID_MAX = 16;

/** CustomMessageRegistration in @nexconn/chat@26.5.1, field for field. */
export interface CustomMessageRegistration {
  messageType: string;
  isPersisted: boolean;
  isCounted: boolean;
  isStatusMessage?: boolean;
  remoteFileUrlField?: string;
}

/**
 * What would be passed to NCEngine.registerCustomMessages. Both are kept in history but not counted as
 * unread: a story or post is not a message waiting for an answer, so it must not light up a badge.
 */
export const MOMENT_MESSAGE_TYPES: CustomMessageRegistration[] = [
  { messageType: 'HL:Story', isPersisted: true, isCounted: false, remoteFileUrlField: 'mediaUrl' },
  { messageType: 'HL:Post', isPersisted: true, isCounted: false, remoteFileUrlField: 'mediaUrl' },
];

export interface MomentEnvelope {
  channel: { type: number; channelId: string; subChannelId: string | null };
  messageType: string;
  content: Record<string, unknown>;
  /** SendMessageParams.metadata: Nexconn accepts string values only. */
  metadata: Record<string, string>;
  needReceipt: boolean;
  /**
   * SendMessageParams.directedUserIds. Null sends to the whole channel. A followers-only story must be
   * directed at the author's followers, or every member of the event channel would receive it.
   */
  directedUserIds: string[] | null;
}

/** What a story or post view shows about its Nexconn mapping. */
export interface NexconnRef {
  messageType: string;
  channel: string;
}

const eventChannel = (eventId: string) => `evt:${eventId}`;
/** The HELLO path of the file. A live connection would put a URL Nexconn can fetch here instead. */
const mediaUrl = (eventId: string, mediaId: string) => `/api/events/${eventId}/media/${mediaId}`;

function storyContent(story: Story): Record<string, unknown> {
  return {
    id: story.id,
    kind: story.kind,
    text: story.text,
    backdrop: story.backdrop,
    ...(story.mediaId ? { mediaUrl: mediaUrl(story.eventId, story.mediaId) } : {}),
    ...(story.spaceId ? { spaceId: story.spaceId } : {}),
  };
}

/**
 * A story goes to the event's community channel, sub-channel `stories`. Views map to read receipts, so
 * the message asks for them. `followerIds` directs a followers-only story; with none, it reaches nobody.
 */
export function storyEnvelope(story: Story, followerIds: readonly string[] = []): MomentEnvelope {
  return {
    channel: { type: NEXCONN_CHANNEL.COMMUNITY, channelId: eventChannel(story.eventId), subChannelId: 'stories' },
    messageType: 'HL:Story',
    content: storyContent(story),
    metadata: {
      expiresAt: String(story.expiresAt),
      audience: story.audience,
      ...(story.spaceId ? { spaceId: story.spaceId } : {}),
    },
    needReceipt: true,
    directedUserIds: story.audience === 'FOLLOWERS' ? [...followerIds] : null,
  };
}

/** A post goes to its community's sub-channel, or to `feed`. */
export function postEnvelope(post: Post): MomentEnvelope {
  const tags = extractTags(post.text);
  const backdrop = post.backdrop ?? null;
  return {
    channel: { type: NEXCONN_CHANNEL.COMMUNITY, channelId: eventChannel(post.eventId), subChannelId: post.communityId ? `community:${post.communityId}` : 'feed' },
    messageType: 'HL:Post',
    content: {
      id: post.id,
      text: post.text,
      backdrop,
      ...(post.mediaId ? { mediaUrl: mediaUrl(post.eventId, post.mediaId), mediaKind: post.mediaKind } : {}),
      ...(post.repostOf ? { repostOf: post.repostOf } : {}),
    },
    metadata: {
      ...(tags.length > 0 ? { tags: tags.join(',') } : {}),
      ...(backdrop ? { backdrop } : {}),
      ...(post.repostOf ? { repostOf: post.repostOf } : {}),
    },
    needReceipt: false,
    directedUserIds: null,
  };
}

/** AddMessageReactionParams for a HELLO reaction. Throws rather than send an id Nexconn would refuse. */
export function reactionFor(id: ReactionId): { reactionId: string } {
  if (id.length > NEXCONN_REACTION_ID_MAX) throw new Error(`Reaction id ${id} is longer than Nexconn allows.`);
  return { reactionId: id };
}

/**
 * A reply to a story, as a direct message quoting it (ReferenceMessageContent). `referMsgId` is the HELLO
 * story id: a live connection would use the id Nexconn gave the story message. HELLO's own direct messages
 * are end-to-end encrypted and this would not be, which is why no reply is sent through it in this build.
 */
export function storyReplyEnvelope(story: Story, text: string): MomentEnvelope {
  return {
    channel: { type: NEXCONN_CHANNEL.DIRECT, channelId: story.authorId, subChannelId: null },
    messageType: 'RC:ReferenceMsg',
    content: { text, referMsgId: story.id, referMsgType: 'HL:Story', referMsgSenderId: story.authorId, referMsg: storyContent(story) },
    metadata: {},
    needReceipt: false,
    directedUserIds: null,
  };
}

const CHANNEL_NAMES: Record<number, string> = { 1: 'direct', 3: 'group', 4: 'open', 6: 'system', 10: 'community' };

/** "community evt:… / stories", plus "· directed" when only some members receive it. */
export function describeChannel(env: MomentEnvelope): string {
  const { type, channelId, subChannelId } = env.channel;
  const name = CHANNEL_NAMES[type] ?? `channel type ${type}`;
  return `${name} ${channelId}${subChannelId ? ` / ${subChannelId}` : ''}${env.directedUserIds ? ' · directed' : ''}`;
}

/** "HL:Story · community evt:… / stories · read receipts". */
export function describeEnvelope(env: MomentEnvelope): string {
  return [env.messageType, describeChannel(env), ...(env.needReceipt ? ['read receipts'] : [])].join(' · ');
}

export function nexconnRef(env: MomentEnvelope): NexconnRef {
  return { messageType: env.messageType, channel: describeChannel(env) };
}
