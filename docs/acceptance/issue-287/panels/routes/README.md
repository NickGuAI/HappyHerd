# Routes panel screenshots

Production source revision: `a38fae51c2f99d34bc4d81b24ccfd4c7aa611b05`. These are after-change screenshots for [PR #289](https://github.com/NickGuAI/HappyHerd/pull/289).

**Evidence boundary:** production-export means the actual exported Web UI on an isolated local host with its backend offline. Component-fixture means real production components with synthetic service/state boundaries and documented Web platform adapters. Neither proves authenticated live journeys, physical iPhone behavior, or installed native clients.

<a id="panel-artifacts"></a>
## Artifacts

**Changed presentation:** Space Grotesk artifact-list copy and KILV list/empty-state presentation.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/artifacts/index.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](artifacts-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](artifacts-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](artifacts-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](artifacts-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="artifacts-populated-light-1440.png"><img src="artifacts-populated-light-1440.png" alt="Artifacts light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="artifacts-populated-light-390.png"><img src="artifacts-populated-light-390.png" alt="Artifacts light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="artifacts-populated-dark-1440.png"><img src="artifacts-populated-dark-1440.png" alt="Artifacts dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="artifacts-populated-dark-390.png"><img src="artifacts-populated-dark-390.png" alt="Artifacts dark 390×844" width="360"></a>

</details>

<a id="panel-artifact"></a>
## Artifact details

**Changed presentation:** KILV artifact title, metadata and rendered content presentation.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/artifacts/[id].tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](artifact-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](artifact-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](artifact-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](artifact-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="artifact-populated-light-1440.png"><img src="artifact-populated-light-1440.png" alt="Artifact details light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="artifact-populated-light-390.png"><img src="artifact-populated-light-390.png" alt="Artifact details light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="artifact-populated-dark-1440.png"><img src="artifact-populated-dark-1440.png" alt="Artifact details dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="artifact-populated-dark-390.png"><img src="artifact-populated-dark-390.png" alt="Artifact details dark 390×844" width="360"></a>

</details>

<a id="panel-artifact-new"></a>
## New artifact editor

**Changed presentation:** KILV typography and themed input/editor presentation for a new artifact.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/artifacts/new.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](artifact-new-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](artifact-new-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](artifact-new-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](artifact-new-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="artifact-new-populated-light-1440.png"><img src="artifact-new-populated-light-1440.png" alt="New artifact editor light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="artifact-new-populated-light-390.png"><img src="artifact-new-populated-light-390.png" alt="New artifact editor light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="artifact-new-populated-dark-1440.png"><img src="artifact-new-populated-dark-1440.png" alt="New artifact editor dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="artifact-new-populated-dark-390.png"><img src="artifact-new-populated-dark-390.png" alt="New artifact editor dark 390×844" width="360"></a>

</details>

<a id="panel-artifact-edit"></a>
## Edit artifact

**Changed presentation:** KILV typography and themed input/editor presentation for an existing artifact.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/artifacts/edit/[id].tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](artifact-edit-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](artifact-edit-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](artifact-edit-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](artifact-edit-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="artifact-edit-populated-light-1440.png"><img src="artifact-edit-populated-light-1440.png" alt="Edit artifact light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="artifact-edit-populated-light-390.png"><img src="artifact-edit-populated-light-390.png" alt="Edit artifact light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="artifact-edit-populated-dark-1440.png"><img src="artifact-edit-populated-dark-1440.png" alt="Edit artifact dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="artifact-edit-populated-dark-390.png"><img src="artifact-edit-populated-dark-390.png" alt="Edit artifact dark 390×844" width="360"></a>

</details>

<a id="panel-friends"></a>
## Friends

**Changed presentation:** KILV friend-list typography and grouped row presentation.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/friends/index.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](friends-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](friends-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](friends-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](friends-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="friends-populated-light-1440.png"><img src="friends-populated-light-1440.png" alt="Friends light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="friends-populated-light-390.png"><img src="friends-populated-light-390.png" alt="Friends light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="friends-populated-dark-1440.png"><img src="friends-populated-dark-1440.png" alt="Friends dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="friends-populated-dark-390.png"><img src="friends-populated-dark-390.png" alt="Friends dark 390×844" width="360"></a>

</details>

<a id="panel-friend-search"></a>
## Find friends

**Changed presentation:** KILV search field, result rows and friend actions.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/friends/search.tsx`, `components/UserSearchResult.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](friend-search-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](friend-search-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](friend-search-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](friend-search-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="friend-search-populated-light-1440.png"><img src="friend-search-populated-light-1440.png" alt="Find friends light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="friend-search-populated-light-390.png"><img src="friend-search-populated-light-390.png" alt="Find friends light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="friend-search-populated-dark-1440.png"><img src="friend-search-populated-dark-1440.png" alt="Find friends dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="friend-search-populated-dark-390.png"><img src="friend-search-populated-dark-390.png" alt="Find friends dark 390×844" width="360"></a>

</details>

<a id="panel-inbox"></a>
## Inbox

**Changed presentation:** KILV inbox headings, activity rows and secondary text hierarchy.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/inbox/index.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](inbox-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](inbox-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](inbox-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](inbox-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="inbox-populated-light-1440.png"><img src="inbox-populated-light-1440.png" alt="Inbox light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="inbox-populated-light-390.png"><img src="inbox-populated-light-390.png" alt="Inbox light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="inbox-populated-dark-1440.png"><img src="inbox-populated-dark-1440.png" alt="Inbox dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="inbox-populated-dark-390.png"><img src="inbox-populated-dark-390.png" alt="Inbox dark 390×844" width="360"></a>

</details>

<a id="panel-machine"></a>
## Machine details

**Changed presentation:** KILV machine settings groups, readable paths and machine action presentation.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/machine/[id].tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](machine-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](machine-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](machine-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](machine-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](machine-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](machine-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](machine-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](machine-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="machine-populated-light-1440.png"><img src="machine-populated-light-1440.png" alt="Machine details light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="machine-scrolled-bottom-light-1440.png"><img src="machine-scrolled-bottom-light-1440.png" alt="Machine details light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="machine-populated-light-390.png"><img src="machine-populated-light-390.png" alt="Machine details light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="machine-scrolled-bottom-light-390.png"><img src="machine-scrolled-bottom-light-390.png" alt="Machine details light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="machine-populated-dark-1440.png"><img src="machine-populated-dark-1440.png" alt="Machine details dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="machine-scrolled-bottom-dark-1440.png"><img src="machine-scrolled-bottom-dark-1440.png" alt="Machine details dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="machine-populated-dark-390.png"><img src="machine-populated-dark-390.png" alt="Machine details dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="machine-scrolled-bottom-dark-390.png"><img src="machine-scrolled-bottom-dark-390.png" alt="Machine details dark 390×844" width="360"></a>

</details>

<a id="panel-session-info"></a>
## Session details

**Changed presentation:** KILV navigation/row surfaces, shared typography, compact controls and semantic status treatment.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/session/[id]/info.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](session-info-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](session-info-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](session-info-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](session-info-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](session-info-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](session-info-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](session-info-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](session-info-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="session-info-populated-light-1440.png"><img src="session-info-populated-light-1440.png" alt="Session details light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="session-info-scrolled-bottom-light-1440.png"><img src="session-info-scrolled-bottom-light-1440.png" alt="Session details light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="session-info-populated-light-390.png"><img src="session-info-populated-light-390.png" alt="Session details light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="session-info-scrolled-bottom-light-390.png"><img src="session-info-scrolled-bottom-light-390.png" alt="Session details light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="session-info-populated-dark-1440.png"><img src="session-info-populated-dark-1440.png" alt="Session details dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="session-info-scrolled-bottom-dark-1440.png"><img src="session-info-scrolled-bottom-dark-1440.png" alt="Session details dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="session-info-populated-dark-390.png"><img src="session-info-populated-dark-390.png" alt="Session details dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="session-info-scrolled-bottom-dark-390.png"><img src="session-info-scrolled-bottom-dark-390.png" alt="Session details dark 390×844" width="360"></a>

</details>

<a id="panel-recent"></a>
## Recent sessions

**Changed presentation:** KILV navigation/row surfaces, shared typography, compact controls and semantic status treatment.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/session/recent.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](recent-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](recent-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](recent-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](recent-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="recent-populated-light-1440.png"><img src="recent-populated-light-1440.png" alt="Recent sessions light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="recent-populated-light-390.png"><img src="recent-populated-light-390.png" alt="Recent sessions light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="recent-populated-dark-1440.png"><img src="recent-populated-dark-1440.png" alt="Recent sessions dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="recent-populated-dark-390.png"><img src="recent-populated-dark-390.png" alt="Recent sessions dark 390×844" width="360"></a>

</details>

<a id="panel-account"></a>
## Account settings

**Changed presentation:** KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/settings/account.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- The displayed all-zero key is synthetic and has no account access.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](account-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](account-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](account-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](account-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](account-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](account-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](account-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](account-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="account-populated-light-1440.png"><img src="account-populated-light-1440.png" alt="Account settings light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="account-scrolled-bottom-light-1440.png"><img src="account-scrolled-bottom-light-1440.png" alt="Account settings light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="account-populated-light-390.png"><img src="account-populated-light-390.png" alt="Account settings light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="account-scrolled-bottom-light-390.png"><img src="account-scrolled-bottom-light-390.png" alt="Account settings light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="account-populated-dark-1440.png"><img src="account-populated-dark-1440.png" alt="Account settings dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="account-scrolled-bottom-dark-1440.png"><img src="account-scrolled-bottom-dark-1440.png" alt="Account settings dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="account-populated-dark-390.png"><img src="account-populated-dark-390.png" alt="Account settings dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="account-scrolled-bottom-dark-390.png"><img src="account-scrolled-bottom-dark-390.png" alt="Account settings dark 390×844" width="360"></a>

</details>

<a id="panel-account-key"></a>
## Synthetic account key

**Changed presentation:** KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `components/AccountKeyPanel.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- The displayed all-zero key is synthetic and has no account access.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](account-key-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](account-key-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](account-key-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](account-key-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="account-key-populated-light-1440.png"><img src="account-key-populated-light-1440.png" alt="Synthetic account key light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="account-key-populated-light-390.png"><img src="account-key-populated-light-390.png" alt="Synthetic account key light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="account-key-populated-dark-1440.png"><img src="account-key-populated-dark-1440.png" alt="Synthetic account key dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="account-key-populated-dark-390.png"><img src="account-key-populated-dark-390.png" alt="Synthetic account key dark 390×844" width="360"></a>

</details>

<a id="panel-agents"></a>
## Agent defaults

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/settings/agents.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](agents-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](agents-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](agents-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](agents-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](agents-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](agents-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](agents-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](agents-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="agents-populated-light-1440.png"><img src="agents-populated-light-1440.png" alt="Agent defaults light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="agents-scrolled-bottom-light-1440.png"><img src="agents-scrolled-bottom-light-1440.png" alt="Agent defaults light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="agents-populated-light-390.png"><img src="agents-populated-light-390.png" alt="Agent defaults light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="agents-scrolled-bottom-light-390.png"><img src="agents-scrolled-bottom-light-390.png" alt="Agent defaults light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="agents-populated-dark-1440.png"><img src="agents-populated-dark-1440.png" alt="Agent defaults dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="agents-scrolled-bottom-dark-1440.png"><img src="agents-scrolled-bottom-dark-1440.png" alt="Agent defaults dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="agents-populated-dark-390.png"><img src="agents-populated-dark-390.png" alt="Agent defaults dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="agents-scrolled-bottom-dark-390.png"><img src="agents-scrolled-bottom-dark-390.png" alt="Agent defaults dark 390×844" width="360"></a>

</details>

<a id="panel-appearance"></a>
## Appearance

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/settings/appearance.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](appearance-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](appearance-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](appearance-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](appearance-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](appearance-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](appearance-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](appearance-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](appearance-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="appearance-populated-light-1440.png"><img src="appearance-populated-light-1440.png" alt="Appearance light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="appearance-scrolled-bottom-light-1440.png"><img src="appearance-scrolled-bottom-light-1440.png" alt="Appearance light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="appearance-populated-light-390.png"><img src="appearance-populated-light-390.png" alt="Appearance light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="appearance-scrolled-bottom-light-390.png"><img src="appearance-scrolled-bottom-light-390.png" alt="Appearance light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="appearance-populated-dark-1440.png"><img src="appearance-populated-dark-1440.png" alt="Appearance dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="appearance-scrolled-bottom-dark-1440.png"><img src="appearance-scrolled-bottom-dark-1440.png" alt="Appearance dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="appearance-populated-dark-390.png"><img src="appearance-populated-dark-390.png" alt="Appearance dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="appearance-scrolled-bottom-dark-390.png"><img src="appearance-scrolled-bottom-dark-390.png" alt="Appearance dark 390×844" width="360"></a>

</details>

<a id="panel-features"></a>
## Features

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/settings/features.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](features-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](features-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](features-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](features-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](features-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](features-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="features-populated-light-1440.png"><img src="features-populated-light-1440.png" alt="Features light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="features-populated-light-390.png"><img src="features-populated-light-390.png" alt="Features light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="features-scrolled-bottom-light-390.png"><img src="features-scrolled-bottom-light-390.png" alt="Features light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="features-populated-dark-1440.png"><img src="features-populated-dark-1440.png" alt="Features dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="features-populated-dark-390.png"><img src="features-populated-dark-390.png" alt="Features dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="features-scrolled-bottom-dark-390.png"><img src="features-scrolled-bottom-dark-390.png" alt="Features dark 390×844" width="360"></a>

</details>

<a id="panel-commanders"></a>
## Commander profile pictures

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `components/CommanderAvatarSettings.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](commanders-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](commanders-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](commanders-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](commanders-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="commanders-populated-light-1440.png"><img src="commanders-populated-light-1440.png" alt="Commander profile pictures light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="commanders-populated-light-390.png"><img src="commanders-populated-light-390.png" alt="Commander profile pictures light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="commanders-populated-dark-1440.png"><img src="commanders-populated-dark-1440.png" alt="Commander profile pictures dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="commanders-populated-dark-390.png"><img src="commanders-populated-dark-390.png" alt="Commander profile pictures dark 390×844" width="360"></a>

</details>

<a id="panel-language"></a>
## Interface language

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/settings/language.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](language-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](language-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](language-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](language-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="language-populated-light-1440.png"><img src="language-populated-light-1440.png" alt="Interface language light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="language-populated-light-390.png"><img src="language-populated-light-390.png" alt="Interface language light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="language-populated-dark-1440.png"><img src="language-populated-dark-1440.png" alt="Interface language dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="language-populated-dark-390.png"><img src="language-populated-dark-390.png" alt="Interface language dark 390×844" width="360"></a>

</details>

<a id="panel-voice"></a>
## Voice settings

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `app/(app)/settings/voice.tsx`, `components/usage/UsageBar.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](voice-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](voice-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](voice-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](voice-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](voice-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](voice-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](voice-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](voice-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="voice-populated-light-1440.png"><img src="voice-populated-light-1440.png" alt="Voice settings light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="voice-scrolled-bottom-light-1440.png"><img src="voice-scrolled-bottom-light-1440.png" alt="Voice settings light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="voice-populated-light-390.png"><img src="voice-populated-light-390.png" alt="Voice settings light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="voice-scrolled-bottom-light-390.png"><img src="voice-scrolled-bottom-light-390.png" alt="Voice settings light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="voice-populated-dark-1440.png"><img src="voice-populated-dark-1440.png" alt="Voice settings dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="voice-scrolled-bottom-dark-1440.png"><img src="voice-scrolled-bottom-dark-1440.png" alt="Voice settings dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="voice-populated-dark-390.png"><img src="voice-populated-dark-390.png" alt="Voice settings dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="voice-scrolled-bottom-dark-390.png"><img src="voice-scrolled-bottom-dark-390.png" alt="Voice settings dark 390×844" width="360"></a>

</details>

<a id="panel-voice-language"></a>
## Voice language

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/settings/voice/language.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](voice-language-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](voice-language-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](voice-language-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](voice-language-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="voice-language-populated-light-1440.png"><img src="voice-language-populated-light-1440.png" alt="Voice language light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="voice-language-populated-light-390.png"><img src="voice-language-populated-light-390.png" alt="Voice language light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="voice-language-populated-dark-1440.png"><img src="voice-language-populated-dark-1440.png" alt="Voice language dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="voice-language-populated-dark-390.png"><img src="voice-language-populated-dark-390.png" alt="Voice language dark 390×844" width="360"></a>

</details>

<a id="panel-claude"></a>
## Connect Claude

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/settings/connect/claude.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Web manual OAuth setup only; native OAuthView WebView is not mounted on Web.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](claude-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](claude-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](claude-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](claude-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="claude-populated-light-1440.png"><img src="claude-populated-light-1440.png" alt="Connect Claude light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="claude-populated-light-390.png"><img src="claude-populated-light-390.png" alt="Connect Claude light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="claude-populated-dark-1440.png"><img src="claude-populated-dark-1440.png" alt="Connect Claude dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="claude-populated-dark-390.png"><img src="claude-populated-dark-390.png" alt="Connect Claude dark 390×844" width="360"></a>

</details>

<a id="panel-terminal"></a>
## Connect terminal

**Changed presentation:** Shared KILV palette, typography, border geometry and interactive control styling.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/terminal/connect.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](terminal-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](terminal-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](terminal-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](terminal-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="terminal-populated-light-1440.png"><img src="terminal-populated-light-1440.png" alt="Connect terminal light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="terminal-populated-light-390.png"><img src="terminal-populated-light-390.png" alt="Connect terminal light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="terminal-populated-dark-1440.png"><img src="terminal-populated-dark-1440.png" alt="Connect terminal dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="terminal-populated-dark-390.png"><img src="terminal-populated-dark-390.png" alt="Connect terminal dark 390×844" width="360"></a>

</details>

<a id="panel-text-selection"></a>
## Select text

**Changed presentation:** Shared KILV palette, typography, border geometry and interactive control styling.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/text-selection.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](text-selection-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](text-selection-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](text-selection-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](text-selection-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="text-selection-populated-light-1440.png"><img src="text-selection-populated-light-1440.png" alt="Select text light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="text-selection-populated-light-390.png"><img src="text-selection-populated-light-390.png" alt="Select text light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="text-selection-populated-dark-1440.png"><img src="text-selection-populated-dark-1440.png" alt="Select text dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="text-selection-populated-dark-390.png"><img src="text-selection-populated-dark-390.png" alt="Select text dark 390×844" width="360"></a>

</details>

<a id="panel-terminal-confirm"></a>
## Terminal connection request

**Changed presentation:** Shared KILV palette, typography, border geometry and interactive control styling.

**Evidence:** `component-fixture`. States: confirmation.

**Production owners:** `app/(app)/terminal/index.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| confirmation | light | 1440×1000 | [Open full screenshot](terminal-confirm-confirmation-light-1440.png) |
| confirmation | light | 390×844 | [Open full screenshot](terminal-confirm-confirmation-light-390.png) |
| confirmation | dark | 1440×1000 | [Open full screenshot](terminal-confirm-confirmation-dark-1440.png) |
| confirmation | dark | 390×844 | [Open full screenshot](terminal-confirm-confirmation-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**confirmation · light · 1440×1000**

<a href="terminal-confirm-confirmation-light-1440.png"><img src="terminal-confirm-confirmation-light-1440.png" alt="Terminal connection request light 1440×1000" width="360"></a>

**confirmation · light · 390×844**

<a href="terminal-confirm-confirmation-light-390.png"><img src="terminal-confirm-confirmation-light-390.png" alt="Terminal connection request light 390×844" width="360"></a>

**confirmation · dark · 1440×1000**

<a href="terminal-confirm-confirmation-dark-1440.png"><img src="terminal-confirm-confirmation-dark-1440.png" alt="Terminal connection request dark 1440×1000" width="360"></a>

**confirmation · dark · 390×844**

<a href="terminal-confirm-confirmation-dark-390.png"><img src="terminal-confirm-confirmation-dark-390.png" alt="Terminal connection request dark 390×844" width="360"></a>

</details>

<a id="panel-terminal-invalid"></a>
## Invalid terminal link

**Changed presentation:** Shared KILV palette, typography, border geometry and interactive control styling.

**Evidence:** `component-fixture`. States: invalid-link.

**Production owners:** `app/(app)/terminal/index.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| invalid-link | light | 1440×1000 | [Open full screenshot](terminal-invalid-invalid-link-light-1440.png) |
| invalid-link | light | 390×844 | [Open full screenshot](terminal-invalid-invalid-link-light-390.png) |
| invalid-link | dark | 1440×1000 | [Open full screenshot](terminal-invalid-invalid-link-dark-1440.png) |
| invalid-link | dark | 390×844 | [Open full screenshot](terminal-invalid-invalid-link-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**invalid-link · light · 1440×1000**

<a href="terminal-invalid-invalid-link-light-1440.png"><img src="terminal-invalid-invalid-link-light-1440.png" alt="Invalid terminal link light 1440×1000" width="360"></a>

**invalid-link · light · 390×844**

<a href="terminal-invalid-invalid-link-light-390.png"><img src="terminal-invalid-invalid-link-light-390.png" alt="Invalid terminal link light 390×844" width="360"></a>

**invalid-link · dark · 1440×1000**

<a href="terminal-invalid-invalid-link-dark-1440.png"><img src="terminal-invalid-invalid-link-dark-1440.png" alt="Invalid terminal link dark 1440×1000" width="360"></a>

**invalid-link · dark · 390×844**

<a href="terminal-invalid-invalid-link-dark-390.png"><img src="terminal-invalid-invalid-link-dark-390.png" alt="Invalid terminal link dark 390×844" width="360"></a>

</details>

<a id="panel-user"></a>
## User profile

**Changed presentation:** Shared KILV palette, typography, border geometry and interactive control styling.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `app/(app)/user/[id].tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](user-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](user-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](user-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](user-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="user-populated-light-1440.png"><img src="user-populated-light-1440.png" alt="User profile light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="user-populated-light-390.png"><img src="user-populated-light-390.png" alt="User profile light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="user-populated-dark-1440.png"><img src="user-populated-dark-1440.png" alt="User profile dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="user-populated-dark-390.png"><img src="user-populated-dark-390.png" alt="User profile dark 390×844" width="360"></a>

</details>

<a id="panel-settings"></a>
## Settings

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `components/SettingsView.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](settings-populated-light-1440.png) |
| scrolled-bottom | light | 1440×1000 | [Open full screenshot](settings-scrolled-bottom-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](settings-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](settings-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](settings-populated-dark-1440.png) |
| scrolled-bottom | dark | 1440×1000 | [Open full screenshot](settings-scrolled-bottom-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](settings-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](settings-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="settings-populated-light-1440.png"><img src="settings-populated-light-1440.png" alt="Settings light 1440×1000" width="360"></a>

**scrolled-bottom · light · 1440×1000**

<a href="settings-scrolled-bottom-light-1440.png"><img src="settings-scrolled-bottom-light-1440.png" alt="Settings light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="settings-populated-light-390.png"><img src="settings-populated-light-390.png" alt="Settings light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="settings-scrolled-bottom-light-390.png"><img src="settings-scrolled-bottom-light-390.png" alt="Settings light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="settings-populated-dark-1440.png"><img src="settings-populated-dark-1440.png" alt="Settings dark 1440×1000" width="360"></a>

**scrolled-bottom · dark · 1440×1000**

<a href="settings-scrolled-bottom-dark-1440.png"><img src="settings-scrolled-bottom-dark-1440.png" alt="Settings dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="settings-populated-dark-390.png"><img src="settings-populated-dark-390.png" alt="Settings dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="settings-scrolled-bottom-dark-390.png"><img src="settings-scrolled-bottom-dark-390.png" alt="Settings dark 390×844" width="360"></a>

</details>

<a id="panel-credentials"></a>
## Saved credentials

**Changed presentation:** KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs.

**Evidence:** `component-fixture`. States: populated, scrolled-bottom.

**Production owners:** `components/CredentialsSettingsView.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.
- Scrolled to the bottom using the existing production overflow container.
- Synthetic service data; native navigation header is outside this fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](credentials-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](credentials-populated-light-390.png) |
| scrolled-bottom | light | 390×844 | [Open full screenshot](credentials-scrolled-bottom-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](credentials-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](credentials-populated-dark-390.png) |
| scrolled-bottom | dark | 390×844 | [Open full screenshot](credentials-scrolled-bottom-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="credentials-populated-light-1440.png"><img src="credentials-populated-light-1440.png" alt="Saved credentials light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="credentials-populated-light-390.png"><img src="credentials-populated-light-390.png" alt="Saved credentials light 390×844" width="360"></a>

**scrolled-bottom · light · 390×844**

<a href="credentials-scrolled-bottom-light-390.png"><img src="credentials-scrolled-bottom-light-390.png" alt="Saved credentials light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="credentials-populated-dark-1440.png"><img src="credentials-populated-dark-1440.png" alt="Saved credentials dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="credentials-populated-dark-390.png"><img src="credentials-populated-dark-390.png" alt="Saved credentials dark 390×844" width="360"></a>

**scrolled-bottom · dark · 390×844**

<a href="credentials-scrolled-bottom-dark-390.png"><img src="credentials-scrolled-bottom-dark-390.png" alt="Saved credentials dark 390×844" width="360"></a>

</details>

<a id="panel-usage"></a>
## Provider usage

**Changed presentation:** KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls.

**Evidence:** `component-fixture`. States: populated.

**Production owners:** `components/usage/UsagePanel.tsx`, `components/usage/UsageChart.tsx`, `components/usage/UsageBar.tsx`.

- Synthetic service/state boundaries; React Native Web adapter; not authenticated live or installed native evidence.
- Known pre-existing chart clipping: upper bars and value labels are clipped by the horizontal ScrollView. Chart height, padding, and bar-scaling geometry are unchanged from baseline 189c504b; KILV changes only typography and semantic colors. The screenshot preserves this defect.
- Expo Router Stack.Screen options are registered but its native navigation header is outside this component fixture.

Fixture environment: [source graph and adapters](environment-routes.json).

| State | Theme | Viewport | Screenshot |
|---|---|---|---|
| populated | light | 1440×1000 | [Open full screenshot](usage-populated-light-1440.png) |
| populated | light | 390×844 | [Open full screenshot](usage-populated-light-390.png) |
| populated | dark | 1440×1000 | [Open full screenshot](usage-populated-dark-1440.png) |
| populated | dark | 390×844 | [Open full screenshot](usage-populated-dark-390.png) |

<details>
<summary>Show every screenshot for this panel</summary>

**populated · light · 1440×1000**

<a href="usage-populated-light-1440.png"><img src="usage-populated-light-1440.png" alt="Provider usage light 1440×1000" width="360"></a>

**populated · light · 390×844**

<a href="usage-populated-light-390.png"><img src="usage-populated-light-390.png" alt="Provider usage light 390×844" width="360"></a>

**populated · dark · 1440×1000**

<a href="usage-populated-dark-1440.png"><img src="usage-populated-dark-1440.png" alt="Provider usage dark 1440×1000" width="360"></a>

**populated · dark · 390×844**

<a href="usage-populated-dark-390.png"><img src="usage-populated-dark-390.png" alt="Provider usage dark 390×844" width="360"></a>

</details>
