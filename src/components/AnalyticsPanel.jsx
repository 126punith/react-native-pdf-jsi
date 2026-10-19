/**
 * AnalyticsPanel - Reading analytics and statistics
 */

import React from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import SidePanel from './SidePanel';

const AnalyticsPanel = ({
  visible,
  onClose,
  analytics,
  licenseInfo,
}) => {
  // Handle null/undefined analytics with defaults
  const safeAnalytics = analytics || {
    timeSpent: 0,
    pagesRead: [],
    totalPages: 0,
    percentage: 0,
    sessions: 0,
    currentPage: 0,
    lastRead: null,
  };
  
  const timeInMinutes = Math.round((safeAnalytics.timeSpent || 0) / 60);
  const pagesReadArray = Array.isArray(safeAnalytics.pagesRead) ? safeAnalytics.pagesRead : [];
  const totalPages = safeAnalytics.totalPages || 0;
  const readingSpeed =
    timeInMinutes > 0 ? pagesReadArray.length / timeInMinutes : 0;
  const remainingPages = totalPages - pagesReadArray.length;
  const estimatedTimeRemaining =
    readingSpeed > 0 ? Math.round(remainingPages / readingSpeed) : 0;

  return (
    <SidePanel visible={visible} onClose={onClose} side="left">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Reading Analytics</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* Progress Ring */}
          <View style={styles.progressSection}>
            <View style={styles.progressRing}>
              <Text style={styles.progressPercent}>
                {safeAnalytics.percentage || 0}%
              </Text>
              <Text style={styles.progressLabel}>Complete</Text>
            </View>
            <View style={styles.progressStats}>
              <Text style={styles.statValue}>
                {pagesReadArray.length}/{totalPages}
              </Text>
              <Text style={styles.statLabel}>Pages Read</Text>
            </View>
          </View>

          {/* Stats Cards */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statIcon}>⏱️</Text>
              <Text style={styles.statCardValue}>{timeInMinutes} min</Text>
              <Text style={styles.statCardLabel}>Time Spent</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statIcon}>📖</Text>
              <Text style={styles.statCardValue}>
                {readingSpeed.toFixed(1)}
              </Text>
              <Text style={styles.statCardLabel}>Pages/min</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statIcon}>🔄</Text>
              <Text style={styles.statCardValue}>{safeAnalytics.sessions || 0}</Text>
              <Text style={styles.statCardLabel}>Sessions</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statIcon}>⏰</Text>
              <Text style={styles.statCardValue}>
                {estimatedTimeRemaining} min
              </Text>
              <Text style={styles.statCardLabel}>Est. Remaining</Text>
            </View>
          </View>

          {/* Session Info */}
          <View style={styles.sessionCard}>
            <Text style={styles.sessionTitle}>Current Session</Text>
            <Text style={styles.sessionInfo}>
              Page {(safeAnalytics.currentPage || 0) + 1} of {totalPages}
            </Text>
            {safeAnalytics.lastRead && (
              <Text style={styles.sessionTime}>
                Last read: {new Date(safeAnalytics.lastRead).toLocaleTimeString()}
              </Text>
            )}
          </View>

          {/* License Badge */}
          <View style={styles.licenseBadge}>
            <Text style={styles.badgeIcon}>🎖️</Text>
            <Text style={styles.badgeText}>
              {licenseInfo?.tier?.toUpperCase() || 'FREE'} License
            </Text>
          </View>
        </ScrollView>
      </View>
    </SidePanel>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  closeButton: {
    fontSize: 24,
    color: '#6B7280',
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  progressRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
  },
  progressPercent: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  progressLabel: {
    fontSize: 12,
    color: '#E0E7FF',
  },
  progressStats: {
    flex: 1,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  statCardValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  statCardLabel: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  sessionCard: {
    backgroundColor: '#EEF2FF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  sessionInfo: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  sessionTime: {
    fontSize: 13,
    color: '#6B7280',
  },
  licenseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  badgeIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
});

export default AnalyticsPanel;
