import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const AUTH_KEY = 'auth_credentials';
const ACCOUNT_KEY_BACKUP_REQUIRED_KEY = 'account_key_backup_required';

// Cache for synchronous access
let credentialsCache: string | null = null;

export interface AuthCredentials {
    token: string;
    secret: string;
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        if (Platform.OS === 'web') {
            return localStorage.getItem(AUTH_KEY) ? JSON.parse(localStorage.getItem(AUTH_KEY)!) as AuthCredentials : null;
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            if (!stored) return null;
            credentialsCache = stored; // Update cache
            return JSON.parse(stored) as AuthCredentials;
        } catch (error) {
            console.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.setItem(AUTH_KEY, JSON.stringify(credentials));
            return true;
        }
        try {
            const json = JSON.stringify(credentials);
            await SecureStore.setItemAsync(AUTH_KEY, json);
            credentialsCache = json; // Update cache
            return true;
        } catch (error) {
            console.error('Error setting credentials:', error);
            return false;
        }
    },

    async getAccountKeyBackupRequired(): Promise<boolean> {
        if (Platform.OS === 'web') {
            return localStorage.getItem(ACCOUNT_KEY_BACKUP_REQUIRED_KEY) === 'true';
        }
        try {
            return await SecureStore.getItemAsync(ACCOUNT_KEY_BACKUP_REQUIRED_KEY) === 'true';
        } catch (error) {
            console.error('Error getting account key backup state:', error);
            return false;
        }
    },

    async setAccountKeyBackupRequired(required: boolean): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.setItem(ACCOUNT_KEY_BACKUP_REQUIRED_KEY, String(required));
            return true;
        }
        try {
            await SecureStore.setItemAsync(ACCOUNT_KEY_BACKUP_REQUIRED_KEY, String(required));
            return true;
        } catch (error) {
            console.error('Error setting account key backup state:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.removeItem(AUTH_KEY);
            localStorage.removeItem(ACCOUNT_KEY_BACKUP_REQUIRED_KEY);
            return true;
        }
        try {
            await Promise.all([
                SecureStore.deleteItemAsync(AUTH_KEY),
                SecureStore.deleteItemAsync(ACCOUNT_KEY_BACKUP_REQUIRED_KEY),
            ]);
            credentialsCache = null; // Clear cache
            return true;
        } catch (error) {
            console.error('Error removing credentials:', error);
            return false;
        }
    },
};
