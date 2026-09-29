import { Typography } from '@/constants/Typography';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { HerdSectionLabel, herdEnterStyles } from '@/components/herd/pages/HerdPage';
import { HerdSegmentedControl } from '@/components/herd/SegmentedControl';
import { layout } from '@/components/layout';
import { UsageChart } from './UsageChart';
import { UsageBar } from './UsageBar';
import { getUsageForPeriod, calculateTotals, UsageCoverage, UsageDataPoint } from '@/sync/apiUsage';
import { Ionicons } from '@expo/vector-icons';
import { HappyHerdError } from '@/utils/errors';
import { t } from '@/text';

type TimePeriod = 'today' | '7days' | '30days';

const styles = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        padding: 16,
        gap: 16,
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    statsCompact: {
        flexDirection: 'column',
    },
    card: {
        minWidth: 0,
        padding: 16,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.kilv.hair,
        backgroundColor: theme.colors.kilv.bgRaised,
    },
    statCard: {
        flex: 1,
        gap: 12,
    },
    statLabel: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    statValue: {
        ...Typography.mono('semiBold'),
        fontSize: 28,
        lineHeight: 36,
        color: theme.colors.text,
    },
    loadingContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    errorContainer: {
        padding: 32,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.status.error,
        textAlign: 'center',
    },
    metricToggle: {
        maxWidth: 280,
        width: '100%',
        alignSelf: 'flex-start',
    },
    coverageList: {
        gap: 8,
    },
    coverageText: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
}));

export const UsagePanel: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const { width } = useWindowDimensions();
    const [period, setPeriod] = useState<TimePeriod>('7days');
    const [chartMetric, setChartMetric] = useState<'tokens' | 'cost'>('tokens');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [usageData, setUsageData] = useState<UsageDataPoint[]>([]);
    const [coverage, setCoverage] = useState<UsageCoverage[]>([]);
    const [totals, setTotals] = useState({
        totalTokens: 0,
        totalCost: 0,
        tokensByProvider: {} as Record<string, number>,
        costByProvider: {} as Record<string, number>
    });

    useEffect(() => {
        loadUsageData();
    }, [period, sessionId]);

    const loadUsageData = async () => {
        if (!auth.credentials) {
            setError('Not authenticated');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await getUsageForPeriod(auth.credentials, period, sessionId);
            setUsageData(response.usage || []);
            setCoverage(response.coverage || []);
            setTotals(calculateTotals(response.usage || []));
        } catch (err) {
            console.error('Failed to load usage data:', err);
            if (err instanceof HappyHerdError) {
                setError(err.message);
            } else {
                setError('Failed to load usage data');
            }
        } finally {
            setLoading(false);
        }
    };

    const formatTokens = (tokens: number): string => {
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(2)}M`;
        } else if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}K`;
        }
        return tokens.toLocaleString();
    };

    const formatCost = (cost: number): string => {
        return `$${cost.toFixed(4)}`;
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.kilv.accent} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={theme.colors.status.error} />
                <Text style={styles.errorText}>{error}</Text>
            </View>
        );
    }

    const providerTotals = Object.entries(totals.tokensByProvider)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    const maxProviderTokens = Math.max(...Object.values(totals.tokensByProvider), 1);
    const coverageGaps = coverage.flatMap((entry) => {
        const gaps: string[] = [];
        if (entry.tokens !== 'reported') {
            gaps.push(t(`usage.coverage.${entry.tokens}`, {
                provider: entry.provider,
                metric: t('usage.tokens'),
            }));
        }
        if (entry.cost !== 'reported') {
            gaps.push(t(`usage.coverage.${entry.cost}`, {
                provider: entry.provider,
                metric: t('usage.cost'),
            }));
        }
        if (entry.costBasis?.includes('provider-estimate')) {
            gaps.push(t('usage.coverage.estimated', { provider: entry.provider }));
        }
        return gaps;
    });

    return (
        <View style={styles.container}>
            <HerdSegmentedControl<TimePeriod>
                testID="usage-period"
                size="touch"
                fit
                value={period}
                onChange={setPeriod}
                options={[
                    { value: 'today', label: t('usage.today') },
                    { value: '7days', label: t('usage.last7Days') },
                    { value: '30days', label: t('usage.last30Days') },
                ]}
            />

            <View testID="usage-summary" style={[styles.statsContainer, width < 700 && styles.statsCompact]}>
                <View testID="usage-stat-tokens" style={[styles.card, styles.statCard, herdEnterStyles.rise(0)]}>
                    <Text style={styles.statLabel}>{t('usage.reportedTokens')}</Text>
                    <Text style={styles.statValue}>{formatTokens(totals.totalTokens)}</Text>
                </View>
                <View testID="usage-stat-cost" style={[styles.card, styles.statCard, herdEnterStyles.rise(1)]}>
                    <Text style={styles.statLabel}>{t('usage.providerCost')}</Text>
                    <Text style={styles.statValue}>{formatCost(totals.totalCost)}</Text>
                </View>
            </View>

            {coverageGaps.length > 0 && (
                <View style={[styles.card, herdEnterStyles.rise(2)]}>
                    <HerdSectionLabel first>{t('usage.coverage.title')}</HerdSectionLabel>
                    <View style={styles.coverageList}>
                        {coverageGaps.map((gap) => (
                            <Text key={gap} style={styles.coverageText}>{gap}</Text>
                        ))}
                    </View>
                </View>
            )}

            {usageData.length > 0 && (
                <View style={[styles.card, herdEnterStyles.rise(3)]}>
                    <HerdSectionLabel first>{t('usage.usageOverTime')}</HerdSectionLabel>
                    <View style={styles.metricToggle}>
                        <HerdSegmentedControl<'tokens' | 'cost'>
                            testID="usage-metric"
                            size="touch"
                            value={chartMetric}
                            onChange={setChartMetric}
                            options={[
                                { value: 'tokens', label: t('usage.tokens') },
                                { value: 'cost', label: t('usage.cost') },
                            ]}
                        />
                    </View>
                    <UsageChart data={usageData} metric={chartMetric} height={180} />
                </View>
            )}

            {providerTotals.length > 0 && (
                <View style={[styles.card, herdEnterStyles.rise(4)]}>
                    <HerdSectionLabel first>{t('usage.byProvider')}</HerdSectionLabel>
                    {providerTotals.map(([provider, tokens]) => (
                        <UsageBar
                            key={provider}
                            label={provider}
                            value={tokens}
                            maxValue={maxProviderTokens}
                            color={theme.colors.kilv.accent}
                        />
                    ))}
                </View>
            )}
        </View>
    );
};
