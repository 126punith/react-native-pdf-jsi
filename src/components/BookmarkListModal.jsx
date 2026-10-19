/**
 * BookmarkListModal - View and navigate all bookmarks with swipe-to-delete
 */

import React, {useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';

const BookmarkListModal = ({
  visible,
  onClose,
  bookmarks,
  onNavigate,
  onDelete,
  currentPage,
}) => {
  const hasBookmarks = bookmarks && bookmarks.length > 0;

  // Debug logging
  React.useEffect(() => {
    if (visible) {
      console.log('📚 [BookmarkListModal] Modal opened');
      console.log('📚 [BookmarkListModal] Bookmarks count:', bookmarks?.length || 0);
      console.log('📚 [BookmarkListModal] Bookmarks data:', JSON.stringify(bookmarks, null, 2));
      console.log('📚 [BookmarkListModal] Current page:', currentPage);
    }
  }, [visible, bookmarks]);

  const handleNavigate = (page) => {
    onNavigate(page);
    onClose();
  };

  const handleDelete = (bookmarkId, bookmarkName) => {
    Alert.alert(
      'Delete Bookmark',
      `Remove "${bookmarkName}"?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(bookmarkId),
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Bookmarks</Text>
              {hasBookmarks && (
                <Text style={styles.count}>{bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}</Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Bookmark List or Empty State */}
          {hasBookmarks ? (
            <ScrollView style={styles.listContainer}>
              {bookmarks.map((bookmark) => (
                <SwipeableBookmarkItem
                  key={bookmark.id}
                  bookmark={bookmark}
                  isCurrentPage={bookmark.page === currentPage}
                  onPress={() => handleNavigate(bookmark.page)}
                  onDelete={() => handleDelete(bookmark.id, bookmark.name)}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔖</Text>
              <Text style={styles.emptyTitle}>No Bookmarks Yet</Text>
              <Text style={styles.emptyMessage}>
                Tap the bookmark icon to save your favorite pages
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

/**
 * SwipeableBookmarkItem - Individual bookmark with swipe-to-delete
 */
const SwipeableBookmarkItem = ({bookmark, isCurrentPage, onPress, onDelete}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  
  // Create PanResponder for swipe gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for horizontal swipes (left)
        return Math.abs(gestureState.dx) > 10 && gestureState.dx < 0;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow left swipe (negative dx), max -80px
        if (gestureState.dx < 0) {
          translateX.setValue(Math.max(gestureState.dx, -80));
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < -40) {
          // Swipe threshold reached - show delete button
          Animated.spring(translateX, {
            toValue: -80,
            useNativeDriver: true,
            tension: 100,
            friction: 8,
          }).start();
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  const handlePress = () => {
    // Close swipe if open
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
    onPress();
  };

  const handleDelete = () => {
    onDelete();
    // Reset swipe position
    translateX.setValue(0);
  };

  return (
    <View style={styles.itemWrapper}>
      {/* Delete Button (behind item) */}
      <View style={styles.deleteBackground}>
        <TouchableOpacity 
          style={styles.deleteButton}
          onPress={handleDelete}
          activeOpacity={0.8}>
          <Text style={styles.deleteIcon}>🗑️</Text>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Swipeable Content */}
      <Animated.View
        style={[
          styles.itemContainer,
          {transform: [{translateX}]},
          isCurrentPage && styles.currentPageItem,
        ]}
        {...panResponder.panHandlers}>
        <TouchableOpacity
          style={styles.itemTouchable}
          onPress={handlePress}
          activeOpacity={0.7}>
          {/* Color Dot */}
          <View style={[styles.colorDot, {backgroundColor: bookmark.color}]} />

          {/* Bookmark Info */}
          <View style={styles.itemContent}>
            <View style={styles.itemHeader}>
              <Text style={styles.bookmarkName} numberOfLines={1}>
                {bookmark.name}
              </Text>
              <Text style={styles.pageNumber}>Page {bookmark.page + 1}</Text>
            </View>
            
            {bookmark.notes && (
              <Text style={styles.notesPreview} numberOfLines={2}>
                {bookmark.notes}
              </Text>
            )}
          </View>

          {/* Current Page Indicator */}
          {isCurrentPage && (
            <View style={styles.currentIndicator}>
              <Text style={styles.currentText}>•</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '70%', // Fixed height instead of maxHeight
    minHeight: 400, // Minimum height to show content
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  count: {
    fontSize: 12,
    color: '#6366F1',
    fontWeight: '600',
    marginTop: 2,
  },
  closeButton: {
    fontSize: 24,
    color: '#6B7280',
    padding: 4,
  },
  listContainer: {
    flex: 1,
    paddingBottom: 20, // Add bottom padding for better scroll
  },
  itemWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  deleteIcon: {
    fontSize: 24,
  },
  deleteText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
    marginTop: 2,
  },
  itemContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    minHeight: 70, // Ensure items are visible
  },
  currentPageItem: {
    backgroundColor: '#F0F9FF',
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  itemTouchable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingVertical: 14,
    minHeight: 70,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
    marginTop: 4, // Align with text baseline
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bookmarkName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    marginRight: 12,
  },
  pageNumber: {
    fontSize: 13,
    color: '#6366F1',
    fontWeight: '600',
  },
  notesPreview: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 18,
  },
  currentIndicator: {
    marginLeft: 8,
  },
  currentText: {
    fontSize: 24,
    color: '#6366F1',
    fontWeight: 'bold',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    minHeight: 300, // Ensure empty state is visible
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
    opacity: 0.3,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default BookmarkListModal;

