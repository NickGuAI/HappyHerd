# Selected upstream Session Info and bot adaptations

This integration adapts selected changes from upstream target SHA `ac64b9b4677870f7b7a9eacfd0780959229717f1` at [github.com/slopus/happy](https://github.com/slopus/happy). The upstream source components adapted are:

* `SessionInfo` adaptations from source commit [dcf38e1002c37d0daf327044a92bd69abed15352](https://github.com/slopus/happy/commit/dcf38e1002c37d0daf327044a92bd69abed15352).
* Bot identity and lifecycle adaptations from source commit [13c7d97810e16e15ebe9a03563130d4a4cd4e00a](https://github.com/slopus/happy/commit/13c7d97810e16e15ebe9a03563130d4a4cd4e00a).

## Scope and machine ownership

These selected changes cover shared metadata, app presentation, and app lifecycle controls. They add no server bot registry, Rig bot publisher, or continuous-conversation allocator. An archive request uses the existing encrypted, session-owned `killSession` RPC. Its acceptance does not prove completed archive: the owning machine must sync `lifecycleState=archived`. The existing session ID and encrypted history remain the conversation identity. Bot identity is independent of Commander binding and the Super Session pin. The app controls do not change server authorization or promise to block a raw authenticated HTTP deletion.

Known bot sessions cannot be deleted through the app; Archive uses the encrypted, session-owned `killSession` RPC without server fallback or worktree cleanup.

## List layout

```text
Grouped Mode Layout:
┌────────────────────────┐
│  [Pin] Super Session   │
├────────────────────────┤
│  [Bots] Synced Bots    │
├────────────────────────┤
│  [Projects] Projects   │
└────────────────────────┘

Flat Mode Activity Layout:
┌────────────────────────┐
│  [Pin] Super Session   │
├────────────────────────┤
│  [Activity Order]      │
│  - Synced Bots         │
│  - Ordinary sessions   │
└────────────────────────┘
```
