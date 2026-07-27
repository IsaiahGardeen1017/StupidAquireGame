# Game session boundary

The client renders a `GameSessionSnapshot` and sends `GameSessionCommand` values to a `GameSession`. It does not know whether its data comes from the tlstyer server, a local engine, or a replay.

## Dependency direction

```text
client/main.ts
    |
    v
src/game/session.ts  <--- LocalGameSession adapter (future)
    ^
    |                <--- replay session (future)
    |
client/tlstyer/TlstyerOnlineClient.ts
    |
    v
client/protocol.ts + client/network.ts
```

Only the tlstyer adapter may interpret numeric command ids, board type ids, score-sheet rows, money scaling, or SockJS payloads. `client/main.ts` works exclusively with named domain values.

## Core contracts

- `GameSession` is the live source. It publishes immutable snapshots and accepts commands.
- `GameSessionSnapshot` contains viewer-safe board, rack, player, chain, action, decision, history, chat, and capability data.
- `GameDecisionRequest` lists the legal context for the human or AI whose turn it is.
- `GameDecision` contains values such as a `Tile` or `HotelChain`, never positions in a protocol array.
- `GameEvent` is structured and replay-safe. Presentation text is produced by the UI.
- `GameSessionCapabilities` lets the same UI progressively expose online chat, local decisions, or replay navigation without testing concrete adapter classes.

Every decision request has an id. A session must reject a response carrying an old id, which prevents a delayed UI, AI, or LLM response from being applied to a later turn.

## Viewer privacy

A snapshot is created for one viewer. `viewerPlayerId` identifies that player, or is `null` for a spectator. Only the viewer's rack is present. Events that reveal an opponent drawing a tile contain `tile: null`. A local engine must construct snapshots with the same rule instead of exposing its internal omniscient state.

The `gameState` included in a decision request is also viewer-specific and immutable. It exists for strategy implementations; the session remains responsible for validating the returned decision.

## Adding the local engine

`AcquireGameEngine` now supplies the private authoritative rules implementation. It owns the board, tile bag, racks, cash, shares, turn order, decisions, and end conditions. A seeded game is deterministic, all player responses are validated before mutation, and runtime invariants check tile, share, and chain-size conservation throughout the game.

The engine gives each `AcquirePlayer` a copied, player-specific `GameState`; controllers never receive its mutable internal state. `AcquireReplay` is intentionally omniscient and records exact draws and decisions so another adapter can later expose privacy-filtered frames to a viewer.

The remaining local-client integration is a `LocalGameSession` that exposes the engine through the existing boundary:

1. Apply game rules and validate commands inside the engine.
2. Run AI players until a human-controlled decision is reached.
3. Publish a new viewer-safe snapshot after each state transition.
4. Record each transition as structured `GameEvent` data.
5. Set `kind: "local"` and advertise only supported capabilities.

The client should bind that session through the same `bindGameSession` path currently used by the online adapter.

## Adding replay support

A `ReplayGameSession` should load immutable recorded frames/events, set `kind: "replay"`, and expose a `ReplayPosition`. It accepts only the replay navigation commands declared in `GameSessionCommand`. It must not synthesize human decisions or mutate the recorded game.

Replay artifacts should be versioned and store domain events and/or domain snapshots. They should never store tlstyer command ids or score-sheet arrays; protocol-specific recordings must be converted when imported.

## Online adapter behavior

`TlstyerOnlineClient` owns login/lobby translation and creates an online `GameSession` when the user joins, rejoins, or watches a game. Its game adapter:

- translates incremental protocol messages into domain snapshots;
- derives named chain state and dollar amounts from server units;
- turns raw history payloads into structured events;
- hides other players' private tile draws;
- validates domain decisions before encoding them;
- buffers game messages received before the server confirms the requested game;
- rejects stale or invalid decisions.

Tests use an injected fake transport, so adapter behavior can be verified without logging in or touching a live game.
