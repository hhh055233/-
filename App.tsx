import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator, Animated, Easing } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';

const API_BASE_URL = 'https://shalat-api.onrender.com';

type RemoteProfile = {
  id: string;
  brand: string;
  model: string;
  verified: boolean;
  imageUrl?: string;
  layout?: { buttons?: string[]; display?: string };
  [key: string]: unknown;
};

export default function App() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [tab, setTab] = useState<'camera' | 'updates'>('camera');
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [catalogVersion, setCatalogVersion] = useState<number | null>(null);
  const [updates, setUpdates] = useState<Array<{ id: string; version: number; title: string; body: string; publishedAt: string; type: string }>>([]);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isIdentifying) { spin.setValue(0); return; }
    const animation = Animated.loop(Animated.timing(spin, {
      toValue: 1, duration: 1150, easing: Easing.linear, useNativeDriver: true
    }));
    animation.start();
    return () => animation.stop();
  }, [isIdentifying, spin]);

  async function loadCatalogStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/updates`);
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      setCatalogVersion(Number(data.version) || 0);
      setUpdates(Array.isArray(data.updates) ? data.updates : []);
      setServerStatus('online');
    } catch { setServerStatus('offline'); }
  }

  async function identifyPhoto(uri: string) {
    setIsIdentifying(true);
    setNotFound(false);
    setRemote(null);
    try {
      const filename = uri.split('/').pop() || 'air-conditioner.jpg';
      const extension = filename.split('.').pop()?.toLowerCase();
      const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      const body = new FormData();
      body.append('photo', { uri, name: filename, type: mimeType } as any);
      const response = await fetch(`${API_BASE_URL}/api/identify`, { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'GEMINI_API_KEY_MISSING') {
          Alert.alert('השירות עדיין בהגדרה', 'שירות הזיהוי עדיין לא הוגדר במלואו.');
        } else {
          Alert.alert('לא הצלחנו לזהות', result.error || 'נסו לצלם שוב תמונה ברורה יותר.');
        }
        return;
      }
      if (result.matchedRemote?.verified === true) {
        setRemote(result.matchedRemote as RemoteProfile);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
    } catch {
      setServerStatus('offline');
      Alert.alert('אין חיבור לשירות', 'בדקו את האינטרנט ונסו שוב.');
    } finally { setIsIdentifying(false); }
  }

  async function openCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('נדרשת הרשאת מצלמה', 'כדי לסרוק מזגן, יש לאפשר ל-SHALAT להשתמש במצלמה.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'], quality: 0.82, allowsEditing: false
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPhoto(uri);
      setRemote(null);
      setNotFound(false);
      await identifyPhoto(uri);
    }
  }

  useEffect(() => { loadCatalogStatus(); openCamera(); }, []);

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.header}>
          <View><Text style={s.eyebrow}>SMART CLIMATE CONTROL</Text><Text style={s.logo}>SHALAT</Text></View>
          <View style={s.status}><View style={s.dot}/><Text style={s.statusText}>מוכן לסריקה</Text></View>
        </View>

        {tab === 'camera' ? <>
          <View style={s.hero}>
            <Text style={s.heroTag}>בלי חיפושים. בלי סיבוכים.</Text>
            <Text style={s.heroTitle}>צלמו מזגן.{ '\n' }קבלו שלט.</Text>
            <Text style={s.heroCopy}>מכוונים למזגן, מצלמים — והשלט המתאים מופיע מיד כשנמצא דגם מאומת.</Text>
            <TouchableOpacity style={s.scanButton} onPress={openCamera} disabled={isIdentifying}>
              <Text style={s.scanButtonText}>◎  צילום מזגן</Text>
            </TouchableOpacity>
          </View>

          {photo && <View style={s.scanStage}>
            <Image source={{ uri: photo }} style={s.photoBackground} />
            {isIdentifying && <View style={s.scanOverlay}>
              <Animated.View style={[s.scanRing, { transform: [{ rotate: rotation }] }]}>
                <View style={s.ringDot} />
              </Animated.View>
              <Text style={s.scanTitle}>סורק את המזגן...</Text>
              <Text style={s.scanSub}>מאתר יצרן ודגם ובודק התאמה לשלט</Text>
            </View>}
          </View>}

          {remote && <View style={s.remoteCard}>
            <Text style={s.foundTag}>✓  נמצא שלט מאומת</Text>
            <Text style={s.remoteBrand}>{remote.brand}</Text>
            <Text style={s.remoteModel}>{remote.model}</Text>
            {remote.imageUrl ? <Image source={{ uri: remote.imageUrl }} style={s.remoteImage} resizeMode="contain" /> : null}
            {Array.isArray(remote.layout?.buttons) && <View style={s.remoteButtons}>
              {remote.layout.buttons.map((button, index) => <View key={index} style={s.remoteButton}><Text style={s.remoteButtonText}>{button}</Text></View>)}
            </View>}
            <Text style={s.smallNote}>השלט מוצג לפי פרופיל מאומת במאגר.</Text>
          </View>}

          {notFound && <View style={s.notFoundCard}>
            <Text style={s.sadRemote}>▣</Text>
            <Text style={s.kneel}>╱|\n╱  ╲</Text>
            <Text style={s.sorry}>אני מצטער ממעמקי נפשי, לא מצאתי לזה שלט 🥺</Text>
            <Text style={s.muted}>אפשר לנסות צילום נוסף, רצוי גם של מדבקת הדגם שעל המזגן.</Text>
            <TouchableOpacity style={s.retryButton} onPress={openCamera}><Text style={s.retryText}>לנסות שוב</Text></TouchableOpacity>
          </View>}

          {!photo && <View style={s.hintCard}><Text style={s.muted}>המצלמה נפתחת מיד עם הכניסה. צלמו את היחידה הפנימית של המזגן.</Text></View>}
          {photo && !isIdentifying && <TouchableOpacity style={s.retryLink} onPress={openCamera}><Text style={s.retryText}>צלמו שוב</Text></TouchableOpacity>}
        </> : <View style={s.panel}>
          <Text style={s.sectionTitle}>מרכז העדכונים</Text>
          <View style={s.updateCard}>
            <Text style={s.updateBadge}>מאגר שלטים</Text>
            <Text style={s.cardTitle}>עדכוני שלטים אוטומטיים</Text>
            <Text style={s.muted}>גרסת המאגר: {catalogVersion ?? 'בודק…'}</Text>
            <Text style={s.muted}>מצב חיבור: {serverStatus === 'online' ? 'מחובר' : serverStatus === 'offline' ? 'לא זמין כרגע' : 'בודק…'}</Text>
          </View>
          {updates.map((item) => <View key={item.id} style={s.updateCard}>
            <Text style={s.updateBadge}>עדכון • גרסה {item.version}</Text>
            <Text style={s.cardTitle}>{item.title}</Text>
            <Text style={s.muted}>{item.body}</Text>
            <Text style={s.updateDate}>{new Date(item.publishedAt).toLocaleDateString('he-IL')}</Text>
          </View>)}
          {serverStatus === 'online' && updates.length === 0 && <Text style={s.muted}>אין עדכונים חדשים כרגע.</Text>}
          <TouchableOpacity style={s.retryButton} onPress={loadCatalogStatus}><Text style={s.retryText}>בדוק עדכונים</Text></TouchableOpacity>
        </View>}

        <View style={s.bottomTabs}>
          <TouchableOpacity onPress={() => setTab('camera')} style={[s.tab, tab === 'camera' && s.activeTab]}><Text style={s.tabText}>מצלמה</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('updates')} style={[s.tab, tab === 'updates' && s.activeTab]}><Text style={s.tabText}>עדכונים</Text></TouchableOpacity>
        </View>
        <Text style={s.footer}>SHALAT • שלט אחד, בדיוק הנכון</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07111f' }, page: { padding: 18, paddingBottom: 34 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: '#67d9d0', fontSize: 9, letterSpacing: 2, fontWeight: '800' }, logo: { color: '#f4f8ff', fontSize: 27, fontWeight: '900', letterSpacing: 3 },
  status: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#102638', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#55d6a5', marginRight: 7 }, statusText: { color: '#c6d8e7', fontSize: 11 },
  hero: { backgroundColor: '#102438', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#1c3b50' },
  heroTag: { color: '#68dcd1', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  heroTitle: { color: '#f4f8ff', fontSize: 34, lineHeight: 41, fontWeight: '900', marginTop: 10, textAlign: 'right' },
  heroCopy: { color: '#a9bdce', fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'right' },
  scanButton: { backgroundColor: '#4bd5c4', borderRadius: 14, padding: 15, marginTop: 18, alignItems: 'center', minHeight: 48 }, scanButtonText: { color: '#06202a', fontWeight: '900', fontSize: 14 },
  scanStage: { height: 280, borderRadius: 22, overflow: 'hidden', marginTop: 16, backgroundColor: '#102438', justifyContent: 'center', alignItems: 'center' },
  photoBackground: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', opacity: 0.72 },
  scanOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,14,25,0.45)', justifyContent: 'center', alignItems: 'center' },
  scanRing: { width: 112, height: 112, borderRadius: 56, borderWidth: 3, borderColor: '#55e0d0', justifyContent: 'flex-start', alignItems: 'center', paddingTop: 2 },
  ringDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#eaffff' },
  scanTitle: { color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 18 }, scanSub: { color: '#d5e8ef', fontSize: 12, marginTop: 6 },
  remoteCard: { backgroundColor: '#102b3e', borderRadius: 22, padding: 20, marginTop: 16, borderWidth: 1, borderColor: '#4bd5c4' },
  foundTag: { color: '#62e2bd', fontSize: 12, fontWeight: '900', textAlign: 'center' }, remoteBrand: { color: '#fff', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 16 },
  remoteModel: { color: '#b8cbd8', fontSize: 14, textAlign: 'center', marginTop: 5 }, remoteImage: { width: '100%', height: 330, marginTop: 14 },
  remoteButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9, marginTop: 18 },
  remoteButton: { minWidth: 74, minHeight: 48, padding: 12, backgroundColor: '#1b4960', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  remoteButtonText: { color: '#fff', fontWeight: '800' }, smallNote: { color: '#9bb7c8', textAlign: 'center', fontSize: 10, marginTop: 14 },
  notFoundCard: { backgroundColor: '#18283a', borderRadius: 22, padding: 20, marginTop: 16, alignItems: 'center', borderWidth: 1, borderColor: '#33485d' },
  sadRemote: { color: '#b9d5df', fontSize: 66, fontWeight: '900', marginTop: 2 }, kneel: { color: '#b9d5df', fontSize: 22, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
  sorry: { color: '#fff', fontSize: 17, lineHeight: 26, fontWeight: '900', textAlign: 'center' },
  muted: { color: '#9cb0c2', fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 9 },
  retryButton: { backgroundColor: '#4bd5c4', borderRadius: 13, paddingVertical: 13, paddingHorizontal: 25, marginTop: 16, minHeight: 46, justifyContent: 'center' },
  retryText: { color: '#06202a', fontWeight: '900', textAlign: 'center' }, retryLink: { padding: 14, alignItems: 'center' },
  hintCard: { backgroundColor: '#102438', padding: 17, borderRadius: 16, marginTop: 16 },
  panel: { marginTop: 18 }, sectionTitle: { color: '#f2f7fc', fontSize: 19, fontWeight: '800', textAlign: 'right', marginBottom: 12 },
  updateCard: { backgroundColor: '#102438', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1b3449' },
  updateBadge: { color: '#65d9ce', fontSize: 10, fontWeight: '800', textAlign: 'right' }, updateDate: { color: '#718da1', fontSize: 10, textAlign: 'right', marginTop: 8 }, cardTitle: { color: '#f2f7fc', fontSize: 15, fontWeight: '800', textAlign: 'right', marginTop: 8 },
  bottomTabs: { flexDirection: 'row', backgroundColor: '#0c1c2b', borderRadius: 14, padding: 4, marginTop: 22 },
  tab: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 11 }, activeTab: { backgroundColor: '#1b394d' }, tabText: { color: '#f3fbff', fontWeight: '800' },
  footer: { color: '#61798d', textAlign: 'center', fontSize: 10, marginTop: 22 }
});
