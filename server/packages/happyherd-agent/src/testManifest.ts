import type { HappyHerdAgentManifest } from './types';

export const TEST_AGENT_MANIFEST: HappyHerdAgentManifest = {
  schemaVersion: 1,
  id: 'example-agent',
  displayName: 'Example governed agent',
  tools: [
    {
      name: 'contacts',
      family: 'contacts',
      description: 'Scoped contact operations',
      operations: {
        list: { method: 'GET', path: '/api/contacts', scope: 'contacts.read', write: false, shared: false },
        get: { method: 'GET', path: '/api/contacts/{contactId}', scope: 'contacts.read', write: false, shared: false },
        create: { method: 'POST', path: '/api/contacts', scope: 'contacts.create', write: true, shared: false },
      },
    },
    {
      name: 'events',
      family: 'events',
      description: 'Shared event reads and personal event writes',
      operations: {
        list: { method: 'GET', path: '/api/events', scope: 'events.read', write: false, shared: true },
        create: { method: 'POST', path: '/api/events', scope: 'events.create', write: true, shared: false },
      },
    },
  ],
};
