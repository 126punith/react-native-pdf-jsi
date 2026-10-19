/**
 * Viewer test screen. The Maestro flows in `example/maestro` drive it through
 * the testIDs below; `status` shows the last viewer event as text.
 */
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PdfPage, PdfView, usePdfDocument, type PdfViewRef, type PdfSource } from 'react-native-pdf-jsi';

const DOCUMENTS: Record<string, { source: PdfSource; password?: string }> = {
  sample: { source: require('./assets/sample.pdf') },
  pages1000: { source: require('./assets/pages-1000.pdf') },
  form: { source: require('./assets/form.pdf') },
  locked: { source: require('./assets/encrypted.pdf') },
  unlocked: { source: require('./assets/encrypted.pdf'), password: 'secret' },
};

function Button({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  return (
    <Pressable testID={id} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** PdfPage thumbnails of the open document; tapping one jumps there. */
function Thumbnails({ source, password, onSelect }: { source: PdfSource; password?: string; onSelect: (page: number) => void }) {
  const { document, error } = usePdfDocument(source, { password });
  const [rendered, setRendered] = useState(0);
  if (error) {
    return <Text style={styles.status}>thumbnails: {error.code}</Text>;
  }
  if (!document) {
    return null;
  }
  const count = Math.min(document.pageCount, 12);
  return (
    <View>
      <ScrollView horizontal style={styles.thumbnails} contentContainerStyle={styles.thumbnailRow}>
        {Array.from({ length: count }, (_, page) => (
          <Pressable key={page} testID={`thumbnail-${page}`} onPress={() => onSelect(page)}>
            <PdfPage document={document} page={page} style={styles.thumbnail} onRender={() => setRendered((n) => n + 1)} />
          </Pressable>
        ))}
      </ScrollView>
      <Text testID="thumbnails" style={styles.status}>
        thumbnails rendered {rendered}
      </Text>
    </View>
  );
}

function App() {
  const viewer = useRef<PdfViewRef>(null);
  const [name, setName] = useState('sample');
  const [horizontal, setHorizontal] = useState(false);
  const [paging, setPaging] = useState(false);
  const [status, setStatus] = useState('idle');
  const [page, setPage] = useState('-');
  const document = DOCUMENTS[name];

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.container}>
        <View style={styles.toolbar}>
          {Object.keys(DOCUMENTS).map((key) => (
            <Button key={key} id={`open-${key}`} label={key} onPress={() => setName(key)} />
          ))}
        </View>
        <View style={styles.toolbar}>
          <Button id="go-last" label="last page" onPress={() => viewer.current?.goToPage(1e6)} />
          <Button id="go-first" label="first page" onPress={() => viewer.current?.goToPage(0, { animated: false })} />
          <Button id="zoom-2" label="zoom 2x" onPress={() => viewer.current?.zoomTo(2)} />
          <Button id="zoom-1" label="zoom 1x" onPress={() => viewer.current?.zoomTo(1)} />
          <Button id="toggle-horizontal" label={horizontal ? 'vertical' : 'horizontal'} onPress={() => setHorizontal((v) => !v)} />
          <Button id="toggle-paging" label={paging ? 'paging off' : 'paging on'} onPress={() => setPaging((v) => !v)} />
        </View>
        <Text testID="status" style={styles.status} numberOfLines={2}>
          {status}
        </Text>
        <Text testID="page" style={styles.status}>
          page {page}
        </Text>
        {name !== 'locked' && (
          <Thumbnails
            key={name}
            source={document.source}
            password={document.password}
            onSelect={(page) => viewer.current?.goToPage(page)}
          />
        )}
        <PdfView
          ref={viewer}
          testID="viewer"
          style={styles.viewer}
          source={document.source}
          password={document.password}
          horizontal={horizontal}
          enablePaging={paging}
          highlights={name === 'sample' ? [{ page: 0, rect: { x: 72, y: 200, width: 120, height: 20 } }] : undefined}
          onLoad={(event) => setStatus(`load pages=${event.pageCount} outline=${event.outline.length}`)}
          onPageChange={(event) => setPage(`${event.page + 1}/${event.pageCount}`)}
          onScaleChange={(event) => setStatus(`scale ${event.scale.toFixed(2)}`)}
          onPageTap={(event) => setStatus(`tap page=${event.page} x=${Math.round(event.x)} y=${Math.round(event.y)}`)}
          onLinkPress={(event) => setStatus(`link ${event.url}`)}
          onPasswordRequired={(event) => setStatus(`password ${event.incorrect ? 'incorrect' : 'required'}`)}
          onError={(error) => setStatus(`error ${error.code}`)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  button: { backgroundColor: '#2563eb', borderRadius: 6, margin: 3, paddingHorizontal: 8, paddingVertical: 6 },
  buttonText: { color: 'white', fontSize: 12 },
  status: { paddingHorizontal: 8, fontSize: 12, color: '#111' },
  viewer: { flex: 1, backgroundColor: '#ccc' },
  thumbnails: { flexGrow: 0 },
  thumbnailRow: { padding: 4, gap: 6, alignItems: 'center' },
  thumbnail: { height: 64 },
});

export default App;
