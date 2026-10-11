import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/auth/AuthContext';
import { fetchVoiceTranscriptionKeyStatus } from '@/sync/apiVoice';
import { resolveVoiceInputAvailability } from './voiceInputAvailability';
import { useSetting } from '@/sync/storage';
import { useLocalVoiceStatus } from './useLocalVoiceStatus';
import { useMachine } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';

/**
 * Voice dictation follows the server-owned OpenAI transcription-key status.
 * The app receives only masked status, never the key itself.
 */
export function useVoiceInputAvailability() {
    const auth = useAuth();
    const [configured, setConfigured] = React.useState(false);
    const [loading, setLoading] = React.useState(Boolean(auth.credentials));
    const localEnabled = useSetting('localVoiceSttEnabled');
    const voiceMachineId = useSetting('localVoiceMachineId');
    const voiceMachine = useMachine(voiceMachineId ?? '');
    const localVoice = useLocalVoiceStatus(localEnabled ? voiceMachineId : null);
    const localReady = Boolean(localEnabled && voiceMachine && isMachineOnline(voiceMachine) && localVoice.status?.stt.state === 'ready');

    useFocusEffect(React.useCallback(() => {
        let cancelled = false;
        if (!auth.credentials) {
            setConfigured(false);
            setLoading(false);
            return () => { cancelled = true; };
        }

        setLoading(true);
        fetchVoiceTranscriptionKeyStatus(auth.credentials)
            .then((status) => {
                if (!cancelled) setConfigured(status.configured);
            })
            .catch(() => {
                if (!cancelled) setConfigured(false);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [auth.credentials]));

    return {
        configured,
        loading: loading && !localReady,
        localReady,
        localMachineId: localReady ? voiceMachineId : null,
        available: resolveVoiceInputAvailability(configured, localReady),
    };
}
