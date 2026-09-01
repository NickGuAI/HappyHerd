---
name: happyherd-develop-ux
description: Implement, repair, or verify Human-facing HappyHerd UX across Web Desktop, Web Mobile, and applicable native surfaces. Use for user-visible features, responsive parity, interaction bugs, entry-point changes, layout or resizer behavior, and any UI delivery whose completion depends on a Human being able to discover and operate the real interface.
---

# HappyHerd UX Delivery

## Goal

A HappyHerd UI change is delivered only when a Human can discover its real
entry point, perform the intended gesture in the production host on every
targeted surface, observe the correct outcome, and retain the required state.

```text
Human → visible entry → real gesture → production component + host
      → visible outcome → retained state
```

Mockups, source inspection, unit tests, builds, and hidden or link-only routes
are supporting evidence. None of them substitutes for this journey.

## Define the Human journey before coding

Write one compact contract for each affected journey:

| Contract field | Required fact |
|---|---|
| Human | Who uses the interface |
| Start | Surface, route, viewport, and relevant initial state |
| Entry | Visible label, icon, menu item, or affordance the Human can find |
| Gesture | Exact click, tap, drag, type, select, upload, save, delete, back, or refresh action |
| Outcome | What changes visibly and what data or state changes |
| Retention | What survives close/reopen, refresh, responsive resize, reconnect, or resume; use `N/A` with a reason when persistence is irrelevant |
| Failure | Visible error and retry or recovery path when the action can fail |

Do not start from a component name or route. Start from what the Human sees and
does. A route, deep link, keyboard shortcut, direct callback, or mounted
component is not an entry point unless the requested journey explicitly begins
there.

## Declare target surfaces

Treat each responsive or native host as a separate acceptance row until the
same journey is proved there:

| Surface | Target status | Entry and host | Required gesture | Verification state |
|---|---|---|---|---|
| Web Desktop | Targeted or excluded with reason |  |  | Unproved |
| Web Mobile | Targeted or excluded with reason |  |  | Unproved |
| iOS | Targeted or excluded with reason |  |  | Unproved |
| macOS | Targeted or excluded with reason |  |  | Unproved |
| Windows | Targeted or excluded with reason |  |  | Unproved |

Do not infer cross-surface parity. Mark a surface excluded only when the owning
task or product contract excludes it, and record why. Missing hardware,
credentials, runtime data, or deployment access is an unproved blocker, not a
pass.

## Preserve the production interaction boundary

- Locate the owning route, containing host, state owner, and shared production
  component before editing. Read the closest guide and begin at `.dev/AGENTS.md`
  when the project has a `.dev` context pack.
- Reuse the production component when two journeys are meant to behave alike.
  Do not create a second workspace, parallel route, or alternate implementation
  to make one surface pass.
- Render small product-owned choice menus as anchored popovers on Web and
  desktop and as safe-area-aware sheets on native. Preserve operating-system
  pickers as the final platform handoff.
- Keep the entry visible, discoverable, enabled, and semantically interactive.
  Verify label or accessible name, role, focus behavior, and state where they
  affect use.
- Exercise the real gesture inside the real host. A mocked callback, direct prop
  invocation, synthetic fixture button, or component-only story stops before
  the interaction boundary and cannot prove the journey.
- For draggable dividers, sliders, scrolling, or responsive layouts, verify the
  requested useful range and its boundaries. Evidence that a control moved by
  an arbitrary small amount does not prove it reaches the Human's target.
- Verify loading, populated, empty, failure, and retry states that are reachable
  in the requested journey. A mounted but blank or dead surface is a failure.
- Preserve the state named in the journey contract, including selection,
  unsaved text, dirty state, scroll position, and open tabs when applicable.

Do not redesign beyond the requested journey. Do not add speculative
abstractions, security layers, fallback hosts, or future-platform machinery.

## Build evidence in distinct planes

Use project-owned verification sources such as `.dev/VERIFY.md` to select
commands. Keep the following proof planes separate:

1. Source and unit evidence proves logic at the owning boundary.
2. Rendered interaction evidence proves the real host exposes the entry and the
   gesture reaches the production component.
3. Build or export evidence proves the artifact assembles.
4. Live evidence proves the exact deployed revision behaves on the real host
   with authoritative runtime state.

For HappyHerd user-visible changes, apply the project gates that the changed
surface triggers:

- regenerate the UI inventory when routes or UI-owning modules change;
- run localization catalog and copy checks;
- update the product changelog and regenerate its checked-in JSON;
- run focused interaction tests, affected package checks, and the production
  Web export; and
- pin live evidence to the exact commit and deployed revision after the last
  UI-affecting change.

An automated browser can supply interaction evidence only when it renders the
production host and operates the same visible control a Human uses. One
screenshot cannot prove a gesture. A build cannot prove discoverability. An
authenticated live page cannot prove a control works unless the action is
actually performed and its result observed.

## Record the acceptance matrix

Retain one row per journey and targeted surface:

| Journey and surface | Entry visible | Gesture executed | Outcome visible | State retained | Evidence | Exact commit/deploy |
|---|---|---|---|---|---|---|
|  | Pass/Fail | Pass/Fail | Pass/Fail | Pass/Fail/N/A | test, screenshot, or recording | SHA and host revision |

Never collapse Desktop and Mobile into one row. Name the production route,
viewport or device, and evidence artifact precisely enough for another agent to
repeat the proof.

## Known failure patterns

These are observed HappyHerd failures, not hypothetical warnings:

- The component rendered, but its Human entry existed only inside a wide-only
  sidebar.
- A mobile or compact host and deep link existed, but no visible mobile control
  opened it from the active journey.
- An embedded browser mounted successfully but stayed empty because the real
  host-to-component data contract was not proved.
- A divider moved in a test, while hard width caps prevented the
  Human-requested range.
- A build reached the server, but no one exercised the live Human interaction.

When one appears, add the regression at the earliest boundary that escaped and
update the affected `.dev` routing or verification rule when source ownership
or future verification guidance changed.

## Done and stop conditions

The work is done only when every targeted matrix row proves the visible entry,
real gesture, visible outcome, and applicable state retention on the final
commit and deployment. The interface must remain usable without a hidden route
or developer-only action.

Keep the task open when any targeted row is unproved. Report `Blocked` or
`Unproved`, the missing prerequisite, and the exact next proof needed. Never
close a UI task on mock, source, test, build, or deployment evidence alone.

## Handoff

Return:

- the Human journey contract and target-surface matrix;
- the owning host, component, and state path reused or changed;
- automated evidence, separated from rendered and live Human-flow evidence;
- the exact commit and deployed revision each artifact proves;
- all unproved rows and blockers; and
- UI inventory, i18n, changelog, `.dev`, and deployment updates that applied.
