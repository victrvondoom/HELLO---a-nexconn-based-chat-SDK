# Nexconn integration

## What was verified (from the published packages, not from memory)

- `@nexconn/chat@26.2.1` (npm). Its `index.d.ts` exports the class **`NCEngine`** with:
  - `static initialize(params: InitParams)`, where `InitParams` is `{ appKey, logLevel?, areaCode?, naviServer? }`.
  - `static connect(params: ConnectParams)`, where `ConnectParams` is `{ token }`. It resolves to `{ userId }`.
  - `static disconnect(disablePush?)`, `static getConnectionStatus()`, `static getCurrentUserId()`.
  - `static addMessageHandler(id, handler)`, `addChannelHandler`, `addGroupChannelHandler`, `addConnectionStatusHandler`.
  - `static registerCustomMessages(params: CustomMessageRegistration[])`, which is the documented route for
    custom message types.
  - Message sending uses message params classes such as `SendTextMessageParams(content)`, and channel objects
    (`DirectChannel`, `GroupChannel`, and others) inherit `sendMessage` and `sendReadReceiptResponse` from `BaseChannel`.
  - Attachments use `SendImageMessageParams`, `SendFileMessageParams` and related classes. Message metadata is set with
    `Message.setMetadata`. Read receipts use `BaseChannel.sendReadReceiptResponse`.
- `@nexconn/chatui@26.2.5` (npm). A UI kit with peer dependencies `@nexconn/engine`, `@nexconn/chat` and `lit`.
  Its entry point is `NCChatUIApplication.initialize({ hooks, language })` and `app.ready()`. It is a browser UI kit.

These names are the only ones this project relies on. Anything not listed above is not assumed to exist.

## What this build does

- `src/integrations/nexconn/status.ts` reports `NOT_CONFIGURED` when `NEXCONN_APP_KEY` is absent, and
  `CONFIGURED_NOT_CONNECTED` when it is present. It never returns the key.
- The conversation page labels its transport "Local demo transport · not Nexconn". It does not claim Nexconn delivery.

## What is not done

1. **No SDK dependency is installed.** `@nexconn/chat` is not in `package.json` yet.
2. **No connection.** `NCEngine.initialize` and `connect` are not called anywhere.
3. **No token service.** `connect` needs a user token. Issuing one needs a server-side endpoint that holds the
   app secret. The Nexconn token API was not verified in this build, so it is not implemented.
4. **No adapter.** The planned boundary is an interface such as `ChatTransport` with `ensureConversation`,
   `sendText`, `subscribe`, and a Nexconn implementation over `NCEngine`. The business logic depends only on that interface.
5. **Not verified:** whether Nexconn exposes delivery receipts for every message type, server-side webhooks, and
   the group/event-channel membership APIs needed for "event channels". Verify them against the official
   documentation before relying on them.

## Browser note

The SDK targets the browser. The integration must run in a client component or behind a dedicated
client module, and it must not expose the app secret.
