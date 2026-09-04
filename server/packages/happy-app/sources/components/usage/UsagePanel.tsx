import React, { useState, useEffect } from 'react';
import { Platform, View, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { ItemGroup } from '@/components/ItemGroup';
import { UsageChart } from './UsageChart';
import { UsageBar } from './UsageBar';
import { getUsageForPeriod, calculateTotals, UsageCoverage, UsageDataPoint } from '@/sync/apiUsage';
import { Ionicons } from '@expo/vector-icons';
import { HappyError } from '@/utils/errors';
import { t } from '@/text';

type TimePeriod = 'today' | '7days' | '30days';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    periodSelector: {
        flexDirection: 'row',
        padding: Platform.select({ web: 16, default: 8 }),
        margin: Platform.select({ web: 0, default: 16 }),
        gap: 8,
        borderRadius: Platform.select({ web: 0, default: 20 }),
        overflow: Platform.select({ web: 'visible', default: 'hidden' }),
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
    },
    periodButton: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: Platform.select({ web: theme.colors.surface, default: theme.colors.surfaceHigh }),
        alignItems: 'center',
    },
    periodButtonActive: {
        backgroundColor: Platform.select({ web: '#007AFF', default: theme.colors.radio.active }),
    },
    periodText: {
        fontSize: 14,
        color: theme.colors.text,
        fontWeight: '500',
    },
    periodTextActive: {
        color: '#FFFFFF',
    },
    statsContainer: {
        padding: 16,
        backgroundColor: theme.colors.surface,
        margin: 16,
        borderRadius: Platform.select({ web: 12, default: 20 }),
        gap: 12,
        overflow: Platform.select({ web: 'visible', default: 'hidden' }),
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
    },
    statRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statLabel: {
        fontSize: 16,
        color: theme.colors.text,
    },
    statValue: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    chartSection: {
        marginTop: 16,
        marginHorizontal: Platform.select({ web: 0, default: 16 }),
        borderRadius: Platform.select({ web: 0, default: 20 }),
        overflow: Platform.select({ web: 'visible', default: 'hidden' }),
        backgroundColor: Platform.select({ web: 'transparent', default: theme.colors.surface }),
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
        marginHorizontal: 16,
        marginTop: Platform.select({ web: 0, default: 16 }),
        marginBottom: 8,
    },
    loadingContainer: {
        flex: 1,
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
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
        padding: 16,
    },
    metricButton: {
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: Platform.select({ web: theme.colors.divider, default: theme.colors.surfaceHigh }),
    },
    metricButtonActive: {
        backgroundColor: Platform.select({ web: '#007AFF', default: theme.colors.radio.active }),
    },
    metricText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    metricTextActive: {
        color: '#FFFFFF',
    },
    coverageList: {
        padding: 16,
        gap: 8,
    },
    coverageText: {
        color: theme.colors.textSecondary,
        fontSize: 14,
    }
}));

export const UsagePanel: React.FC<{ sessionId?: string }> = ({ sessionId }) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
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
            if (err instanceof HappyError) {
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
    
    const periodLabels: Record<TimePeriod, string> = {
        'today': t('usage.today'),
        '7days': t('usage.last7Days'),
        '30days': t('usage.last30Days')
    };
    
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
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
        <ScrollView style={styles.container}>
            {/* Period Selector */}
            <View style={styles.periodSelector}>
                {(['today', '7days', '30days'] as TimePeriod[]).map((p) => (
                    <Pressable
                        key={p}
                        style={[styles.periodButton, period === p && styles.periodButtonActive]}
                        onPress={() => setPeriod(p)}
                    >
                        <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                            {periodLabels[p]}
                        </Text>
                    </Pressable>
                ))}
            </View>
            
            {/* Summary Stats */}
            <View style={styles.statsContainer}>
                <View style={styles.statRow}>
                    <Text style={styles.statLabel}>{t('usage.reportedTokens')}</Text>
                    <Text style={styles.statValue}>{formatTokens(totals.totalTokens)}</Text>
                </View>
                <View style={styles.statRow}>
                    <Text style={styles.statLabel}>{t('usage.providerCost')}</Text>
                    <Text style={styles.statValue}>{formatCost(totals.totalCost)}</Text>
                </View>
            </View>

            {coverageGaps.length > 0 && (
                <ItemGroup title={t('usage.coverage.title')}>
                    <View style={styles.coverageList}>
                        {coverageGaps.map((gap) => (
                            <Text key={gap} style={styles.coverageText}>{gap}</Text>
                        ))}
                    </View>
                </ItemGroup>
            )}
            
            {/* Usage Chart */}
            {usageData.length > 0 && (
                <View style={styles.chartSection}>
                    <Text style={styles.sectionTitle}>{t('usage.usageOverTime')}</Text>
                    
                    {/* Metric Toggle */}
                    <View style={styles.metricToggle}>
                        <Pressable
                            style={[styles.metricButton, chartMetric === 'tokens' && styles.metricButtonActive]}
                            onPress={() => setChartMetric('tokens')}
                        >
                            <Text style={[styles.metricText, chartMetric === 'tokens' && styles.metricTextActive]}>
                                {t('usage.tokens')}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.metricButton, chartMetric === 'cost' && styles.metricButtonActive]}
                            onPress={() => setChartMetric('cost')}
                        >
                            <Text style={[styles.metricText, chartMetric === 'cost' && styles.metricTextActive]}>
                                {t('usage.cost')}
                            </Text>
                        </Pressable>
                    </View>
                    
                    <UsageChart 
                        data={usageData}
                        metric={chartMetric}
                        height={180}
                    />
                </View>
            )}
            
            {/* Usage by provider */}
            {providerTotals.length > 0 && (
                <ItemGroup title={t('usage.byProvider')}>
                    <View style={{ padding: 16 }}>
                        {providerTotals.map(([provider, tokens]) => (
                            <UsageBar
                                key={provider}
                                label={provider}
                                value={tokens}
                                maxValue={maxProviderTokens}
                                color="#007AFF"
                            />
                        ))}
                    </View>
                </ItemGroup>
            )}
        </ScrollView>
    );
};
