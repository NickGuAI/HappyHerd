import * as React from 'react';
import { Stack } from 'expo-router';

import { HerdPageHeader, useHerdWideLayout } from '@/components/herd/pages/HerdPage';
import { t } from '@/text';

/**
 * What's New's page frame (UI overhaul): on wide layouts the mock's large
 * title and subtitle sit in the page and the header bar is hidden; phones keep
 * the header bar and its title.
 */
export function ChangelogPageFrame() {
    const wide = useHerdWideLayout();
    return (
        <>
            <Stack.Screen options={{ headerShown: !wide }} />
            {wide ? (
                <HerdPageHeader
                    title={t('navigation.whatsNew')}
                    subtitle={t('updateBanner.seeLatest')}
                    testID="changelog-page-header"
                />
            ) : null}
        </>
    );
}
