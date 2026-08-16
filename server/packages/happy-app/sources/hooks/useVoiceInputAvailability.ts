import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/auth/AuthContext';
import { fetchVoiceTranscriptionKeyStatus } from '@/sync/apiVoice';
import { useSetting } from '@/sync/storage';
import { resolveVoiceInputAvailability } from './voiceInputAvailability';

/**
 * Voice dictation is an explicit two-part capability: the synchronized feature
 * switch must be enabled and the server must confirm that an encrypted OpenAI
 * transcription key exists. The app receives only masked status, never the key.
 */
export function useVoiceInputAvailability() {
    const auth = useAuth();
    const enabled = useSetting('voiceInputEnabled');
    const [configured, setConfigured] = React.useState(false);
    const [loading, setLoading] = React.useState(enabled);

    useFocusEffect(React.useCallback(() => {
        let cancelled = false;
        if (!enabled || !auth.credentials) {
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
    }, [auth.credentials, enabled]));

    return {
        enabled,
        configured,
        loading,
        available: resolveVoiceInputAvailability(enabled, configured),
    };
}
