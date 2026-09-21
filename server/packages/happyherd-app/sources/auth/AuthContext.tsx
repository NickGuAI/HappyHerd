import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { TokenStorage, AuthCredentials } from '@/auth/tokenStorage';
import { syncCreate } from '@/sync/sync';
import * as Updates from 'expo-updates';
import { clearPersistence, loadRegisteredPushToken } from '@/sync/persistence';
import { unregisterPushToken } from '@/sync/apiPush';
import { Platform } from 'react-native';
import { trackLogout } from '@/track';
import { requiresAccountKeyBackup, type AccountLoginMethod } from '@/auth/accountKeyLifecycle';

interface AuthContextType {
    isAuthenticated: boolean;
    credentials: AuthCredentials | null;
    accountKeyBackupRequired: boolean;
    login: (token: string, secret: string, method: AccountLoginMethod) => Promise<void>;
    confirmAccountKeyBackup: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
    children,
    initialCredentials,
    initialAccountKeyBackupRequired,
}: {
    children: ReactNode;
    initialCredentials: AuthCredentials | null;
    initialAccountKeyBackupRequired: boolean;
}) {
    const [isAuthenticated, setIsAuthenticated] = useState(!!initialCredentials);
    const [credentials, setCredentials] = useState<AuthCredentials | null>(initialCredentials);
    const [accountKeyBackupRequired, setAccountKeyBackupRequired] = useState(
        !!initialCredentials && initialAccountKeyBackupRequired
    );

    // Update global auth state when local state changes
    useEffect(() => {
        setCurrentAuth(credentials ? {
            isAuthenticated,
            credentials,
            accountKeyBackupRequired,
            login,
            confirmAccountKeyBackup,
            logout,
        } : null);
    }, [isAuthenticated, credentials, accountKeyBackupRequired]);

    const login = async (token: string, secret: string, method: AccountLoginMethod) => {
        const newCredentials: AuthCredentials = { token, secret };
        const backupRequired = requiresAccountKeyBackup(method);
        const backupStateSaved = await TokenStorage.setAccountKeyBackupRequired(backupRequired);
        if (!backupStateSaved) {
            throw new Error('Failed to save account key backup state');
        }

        const credentialsSaved = await TokenStorage.setCredentials(newCredentials);
        if (!credentialsSaved) {
            await TokenStorage.setAccountKeyBackupRequired(false);
            throw new Error('Failed to save credentials');
        }

        await syncCreate(newCredentials);
        setCredentials(newCredentials);
        setAccountKeyBackupRequired(backupRequired);
        setIsAuthenticated(true);
    };

    const confirmAccountKeyBackup = async () => {
        const success = await TokenStorage.setAccountKeyBackupRequired(false);
        if (!success) {
            throw new Error('Failed to confirm account key backup');
        }
        setAccountKeyBackupRequired(false);
    };

    const logout = async () => {
        trackLogout();
        const registeredPushToken = credentials ? loadRegisteredPushToken() : null;
        if (credentials && registeredPushToken) {
            try {
                await unregisterPushToken(credentials, registeredPushToken);
            } catch (error) {
                console.log('Failed to unregister push token during logout:', error);
            }
        }
        clearPersistence();
        await TokenStorage.removeCredentials();
        
        // Update React state to ensure UI consistency
        setCredentials(null);
        setAccountKeyBackupRequired(false);
        setIsAuthenticated(false);
        
        if (Platform.OS === 'web') {
            window.location.reload();
        } else {
            try {
                await Updates.reloadAsync();
            } catch (error) {
                // In dev mode, reloadAsync will throw ERR_UPDATES_DISABLED
                console.log('Reload failed (expected in dev mode):', error);
            }
        }
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                credentials,
                accountKeyBackupRequired,
                login,
                confirmAccountKeyBackup,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Helper to get current auth state for non-React contexts
let currentAuthState: AuthContextType | null = null;

export function setCurrentAuth(auth: AuthContextType | null) {
    currentAuthState = auth;
}

export function getCurrentAuth(): AuthContextType | null {
    return currentAuthState;
}
