import { storage } from './storage';
import { sync } from './sync';
import { getServerUrl } from './serverConfig';
import { getHappyHerdClientId } from './apiSocket';
import { FeedReadReceiptSchema } from './feedTypes';

async function markFeedRead(target: { id: string } | { through: string }): Promise<void> {
    const account = storage.getState().feedAccount;
    const credentials = sync.getCredentials();
    const endpoint = getServerUrl();
    if (!credentials || !account) throw new Error('Feed is not authenticated');
    // Capture both credentials and endpoint before awaiting. Switching accounts
    // cannot send the old Inbox's cursor to the new account or apply its reply.
    const response = await fetch(`${endpoint}/v1/feed/read`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${credentials.token}`,
            'X-Happy-Client': getHappyHerdClientId(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(target),
    });
    if (!response.ok) throw new Error(`Failed to mark feed read: ${response.status}`);
    const receipt = FeedReadReceiptSchema.parse(await response.json());
    if (storage.getState().feedAccount === account && getServerUrl() === endpoint) {
        storage.getState().applyFeedRead(receipt);
    }
}

export async function markFeedItemRead(id: string): Promise<void> {
    const item = storage.getState().feedItems.find(item => item.id === id);
    if (!item || item.readAt != null) return;
    await markFeedRead({ id });
}

export async function markAllFeedRead(): Promise<void> {
    const { feedHead } = storage.getState();
    if (!feedHead) return;
    await markFeedRead({ through: feedHead });
}
