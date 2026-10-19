/**
 * Viewer test screen. The Maestro flows in `example/maestro` drive it through
 * the testIDs below; `status` shows the last viewer event as text.
 */
import { useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PdfView, type PdfViewRef, type PdfSource } from 'react-native-pdf-jsi';

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
});

export default App;
