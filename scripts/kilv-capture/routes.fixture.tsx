// Screenshot-only host. All displayed product panels are real production imports.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Artifacts from '@/app/(app)/artifacts/index';
import Artifact from '@/app/(app)/artifacts/[id]';
import ArtifactEdit from '@/app/(app)/artifacts/edit/[id]';
import ArtifactNew from '@/app/(app)/artifacts/new';
import Friends from '@/app/(app)/friends/index';
import FriendSearch from '@/app/(app)/friends/search';
import Inbox from '@/app/(app)/inbox/index';
import Machine from '@/app/(app)/machine/[id]';
import SessionInfo from '@/app/(app)/session/[id]/info';
import Recent from '@/app/(app)/session/recent';
import Account from '@/app/(app)/settings/account';
import Agents from '@/app/(app)/settings/agents';
import Appearance from '@/app/(app)/settings/appearance';
import Features from '@/app/(app)/settings/features';
import Language from '@/app/(app)/settings/language';
import Voice from '@/app/(app)/settings/voice';
import VoiceLanguage from '@/app/(app)/settings/voice/language';
import Claude from '@/app/(app)/settings/connect/claude';
import TerminalConfirm from '@/app/(app)/terminal/index';
import Terminal from '@/app/(app)/terminal/connect';
import TextSelection from '@/app/(app)/text-selection';
import User from '@/app/(app)/user/[id]';
import { SettingsView } from '@/components/SettingsView';
import { CredentialsSettingsView } from '@/components/CredentialsSettingsView';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { CommanderAvatarSettings } from '@/components/CommanderAvatarSettings';
import { AccountKeyPanel } from '@/components/AccountKeyPanel';
import { ItemList } from '@/components/ItemList';
import '@/theme.css';
const scenes = {
 artifacts: Artifacts, artifact: Artifact, 'artifact-edit':ArtifactEdit,'artifact-new':ArtifactNew,
 friends:Friends,'friend-search':FriendSearch,inbox:Inbox,machine:Machine,'session-info':SessionInfo,recent:Recent,
 account:Account,agents:Agents,appearance:Appearance,features:Features,language:Language,voice:Voice,'voice-language':VoiceLanguage,
 claude:Claude,terminal:Terminal,'terminal-confirm':TerminalConfirm,'terminal-invalid':TerminalConfirm,'text-selection':TextSelection,user:User,settings:SettingsView,credentials:CredentialsSettingsView,
 usage:()=> <ItemList><UsagePanel /></ItemList>,commanders:()=> <ItemList><CommanderAvatarSettings /></ItemList>,
 'account-key':()=> <ItemList><AccountKeyPanel secret="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" /></ItemList>,
};
const key = new URLSearchParams(location.search).get('scene') || 'artifacts';
function Fixture() {
 const {theme}=useUnistyles(); const Panel=scenes[key];
 return <View style={{minHeight:'100vh',height:'100vh',backgroundColor:theme.colors.groupped.background}}><Panel /></View>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
