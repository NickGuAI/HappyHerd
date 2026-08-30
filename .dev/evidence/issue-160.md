# Issue 160 interaction evidence

Base: `0d19fced`

## Contract

The visible Side chats count control must open and collapse the selected parent
session's Side chat surface. A retained background session must not interfere
with the foreground panel.

## Root cause

The open panel list was device-global. React Navigation retained background
`SessionView` instances, and a background view with no child chats immediately
cleared the foreground session's newly opened Side chat state.

## RED

On the untouched base, the real Chromium fixture clicked the foreground Side
chats control and timed out waiting for `Collapse side chats`. The mounted
zero-child background view had cleared the shared state after the click.

## GREEN

Two real Chromium interaction tests pass. The desktop flow opens the newest
exact-parent child, switches to the older child, creates no child, and
collapses on the second header click while a zero-child background session
remains mounted. The width-700 flow proves the same selection, switch, no-create,
and collapse behavior in the narrow full-screen host.

## Fix

The open Side chat panel records its parent session as owner. Opening writes
the panel and owner together; unrelated mounted sessions neither render nor
clear it, and only the owning parent clears that ownership.
