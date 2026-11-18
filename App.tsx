import React, { useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';

const API_BASE_URL = 'https://shalat-api.onrender.com';

type Brand = 'Samsung' | 'LG' | 'Electra' | 'Tadiran' | 'Tornado';
type Remote = { id: string; brand: Brand; model: string; note: string; verified: boolean };

const REMOTES: Remote[] = [
  { id: 'sample-samsung', brand: 'Samsung', model: 'Samsung • תבנית שלט לדוגמה', note: 'תבנית ממשק בלבד — טרם אומתה מול מזגן פיזי', verified: false },
  { id: 'sample-lg', brand: 'LG', model: 'LG • תבנית שלט לדוגמה', note: 'תבנית ממשק בלבד — טרם אומתה מול מזגן פיזי', verified: false },
  { id: 'sample-electra', brand: 'Electra', model: 'Electra • תבנית שלט לדוגמה', note: 'תבנית ממשק בלבד — טרם אומתה מול מזגן פיזי', verified: false },
  { id: 'sample-tadiran', brand: 'Tadiran', model: 'Tadiran • תבנית שלט לדוגמה', note: 'תבנית ממשק בלבד — טרם אומתה מול מזגן פיזי', verified: false },
  { id: 'sample-tornado', brand: 'Tornado', model: 'Tornado • תבנית שלט לדוגמה', note: 'תבנית ממשק בלבד — טרם אומתה מול מזגן פיזי', verified: false }
];

export default function App() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [temperature, setTemperature] = useState(24);
  const [mode, setMode] = useState('קירור');
  const [tab, setTab] = useState<'remote' | 'updates'>('remote');
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [catalogVersion, setCatalogVersion] = useState<number | null>(null);

  async function loadCatalogStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/updates`);
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      setCatalogVersion(Number(data.version) || 0);
      setServerStatus('online');
    } catch {
      setServerStatus('offline');
    }
  }

  async function identifyPhoto(uri: string) {
    setIsIdentifying(true);
    try {
      const filename = uri.split('/').pop() || 'air-conditioner.jpg';
      const extension = filename.split('.').pop()?.toLowerCase();
      const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      const body = new FormData();
      body.append('photo', { uri, name: filename, type: mimeType } as any);
      const response = await fetch(`${API_BASE_URL}/api/identify`, {
        method: 'POST',
        body
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'GEMINI_API_KEY_MISSING') {
          Alert.alert('השירות עדיין בהגדרה', 'אפשרות זיהוי הדגם תהיה זמינה לאחר השלמת הגדרת השירות.');
        } else {
          Alert.alert('לא הצלחנו לזהות את המזגן', result.error || 'נסו שוב עם תמונה ברורה יותר.');
        }
        return;
      }
      const identifiedBrand = String(result.identification?.brand || '');
      const matched = REMOTES.find(item => item.brand.toLowerCase() === identifiedBrand.toLowerCase());
      if (result.matchedRemote?.verified) {
        Alert.alert('נמצא שלט תואם', 'זוהה דגם ונמצא שלט מאומת במאגר.');
      } else if (matched) {
        Alert.alert('זיהינו את היצרן', `היצרן שזוהה: ${identifiedBrand}. עדיין אין במאגר שלט מאומת לדגם הזה.`);
      } else {
        Alert.alert('הזיהוי הושלם', 'לא נמצא עדיין שלט מאומת שמתאים למזגן הזה במאגר.');
      }
    } catch {
      Alert.alert('אין חיבור לשירות', 'בדקו את חיבור האינטרנט ונסו שוב.');
      setServerStatus('offline');
    } finally {
      setIsIdentifying(false);
    }
  }

  async function scanAirConditioner() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('נדרשת הרשאה', 'כדי לבחור תמונה, יש לאפשר גישה לתמונות.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPhoto(uri);
      setRemote(null);
      await identifyPhoto(uri);
    }
  }

  function chooseRemote(item: Remote) {
    setRemote(item);
    setTab('remote');
  }

  React.useEffect(() => { loadCatalogStatus(); }, []);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.header}>
          <View><Text style={s.eyebrow}>SMART CLIMATE CONTROL</Text><Text style={s.logo}>SHALAT</Text></View>
          <View style={s.status}><View style={s.dot}/><Text style={s.statusText}>מוכן להגדרה</Text></View>
        </View>
        <View style={s.hero}>
          <Text style={s.heroTag}>השלט הנכון, בלי לחפש</Text>
          <Text style={s.heroTitle}>המזגן שלך.{ '\n' }השלט שלך.</Text>
          <Text style={s.heroCopy}>צלמו את המזגן, ו-SHALAT יעזור למצוא את השלט המתאים מתוך המאגר.</Text>
          <TouchableOpacity style={[s.scanButton, isIdentifying && s.disabled]} onPress={scanAirConditioner} disabled={isIdentifying}>
            {isIdentifying ? <ActivityIndicator color="#06202a" /> : <Text style={s.scanButtonText}>＋  בחירת תמונת מזגן</Text>}
          </TouchableOpacity>
          {photo ? <Image source={{ uri: photo }} style={s.preview} /> : null}
        </View>
        <View style={s.tabs}>
          <TouchableOpacity onPress={() => setTab('remote')} style={[s.tab, tab === 'remote' && s.activeTab]}><Text style={[s.tabText, tab === 'remote' && s.activeTabText]}>השלט שלי</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('updates')} style={[s.tab, tab === 'updates' && s.activeTab]}><Text style={[s.tabText, tab === 'updates' && s.activeTabText]}>עדכונים</Text></TouchableOpacity>
        </View>
        {tab === 'updates' ? <View style={s.panel}>
          <Text style={s.sectionTitle}>מרכז העדכונים</Text>
          <View style={s.updateCard}><Text style={s.updateBadge}>מאגר שלטים</Text><Text style={s.cardTitle}>עדכוני שלטים אוטומטיים</Text><Text style={s.muted}>המערכת בודקת את גרסת המאגר ומציגה עדכונים חדשים כשהם זמינים.</Text><Text style={s.muted}>מצב חיבור: {serverStatus === 'online' ? 'מחובר' : serverStatus === 'offline' ? 'לא זמין כרגע' : 'בודק…'}{catalogVersion !== null ? ` • גרסה ${catalogVersion}` : ''}</Text></View>
          <View style={s.updateCard}><Text style={s.updateBadge}>בהכנה</Text><Text style={s.cardTitle}>Wi-Fi ו-IR</Text><Text style={s.muted}>חיבורי השליטה יופעלו לאחר שילוב מתאמי תקשורת ואימות התאימות לכל דגם.</Text></View>
        </View> : <View style={s.panel}>
          <Text style={s.sectionTitle}>{remote ? 'השלט שנבחר' : 'בחירת שלט מהמאגר'}</Text>
          {remote ? <View style={s.remote}>
            <Text style={s.remoteBrand}>{remote.brand.toUpperCase()}</Text><Text style={s.remoteModel}>{remote.model}</Text>
            <View style={s.screen}><Text style={s.screenLabel}>SET TEMP</Text><Text style={s.temp}>{temperature}°</Text><Text style={s.screenMode}>{mode}</Text></View>
            <View style={s.controls}>
              <TouchableOpacity style={s.control} onPress={() => setTemperature(Math.min(30, temperature + 1))}><Text style={s.controlText}>＋</Text></TouchableOpacity>
              <TouchableOpacity style={s.control} onPress={() => setTemperature(Math.max(16, temperature - 1))}><Text style={s.controlText}>－</Text></TouchableOpacity>
            </View>
            <View style={s.modes}>{['קירור','חימום','אוורור','ייבוש'].map(m => <TouchableOpacity key={m} onPress={() => setMode(m)} style={[s.mode, mode === m && s.modeSelected]}><Text style={s.modeText}>{m}</Text></TouchableOpacity>)}</View>
            <Text style={s.warning}>{remote.note}. הכפתורים משנים כרגע את תצוגת ההדגמה בלבד ואינם שולחים פקודות למזגן.</Text>
          </View> : <Text style={s.muted}>בחרו יצרן כדי להציג תבנית שלט ראשונית. בהמשך יוצגו שלטים מאומתים לפי זיהוי הדגם.</Text>}
          {REMOTES.map(item => <TouchableOpacity key={item.id} style={s.brandRow} onPress={() => chooseRemote(item)}><View><Text style={s.brandName}>{item.brand}</Text><Text style={s.brandSub}>תבנית שלט במאגר • דוגמה</Text></View><Text style={s.arrow}>‹</Text></TouchableOpacity>)}
        </View>}
        <Text style={s.footer}>SHALAT • גרסת פיתוח ראשונית</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07111f' }, page: { padding: 20, paddingBottom: 36 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: '#67d9d0', fontSize: 9, letterSpacing: 2, fontWeight: '800' }, logo: { color: '#f4f8ff', fontSize: 27, fontWeight: '900', letterSpacing: 3 },
  status: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#102638', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#55d6a5', marginRight: 7 }, statusText: { color: '#c6d8e7', fontSize: 11 },
  hero: { backgroundColor: '#102438', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#1c3b50' },
  heroTag: { color: '#68dcd1', fontSize: 12, fontWeight: '700' }, heroTitle: { color: '#f4f8ff', fontSize: 34, lineHeight: 41, fontWeight: '900', marginTop: 10, textAlign: 'right' },
  heroCopy: { color: '#a9bdce', fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'right' },
  scanButton: { backgroundColor: '#4bd5c4', borderRadius: 14, padding: 15, marginTop: 18, alignItems: 'center' }, disabled: { opacity: 0.7 }, scanButtonText: { color: '#06202a', fontWeight: '900', fontSize: 14 },
  preview: { width: '100%', height: 160, borderRadius: 14, marginTop: 14, resizeMode: 'cover' },
  tabs: { flexDirection: 'row', backgroundColor: '#0c1c2b', borderRadius: 14, padding: 4, marginTop: 20 },
  tab: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 11 }, activeTab: { backgroundColor: '#1b394d' }, tabText: { color: '#8da4b8', fontWeight: '700' }, activeTabText: { color: '#ffffff' },
  panel: { marginTop: 20 }, sectionTitle: { color: '#f2f7fc', fontSize: 19, fontWeight: '800', textAlign: 'right', marginBottom: 12 },
  muted: { color: '#9cb0c2', fontSize: 13, lineHeight: 21, textAlign: 'right', marginBottom: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#102438', borderRadius: 14, marginTop: 9, borderWidth: 1, borderColor: '#1b3449' },
  brandName: { color: '#f4f8ff', fontSize: 16, fontWeight: '800', textAlign: 'right' }, brandSub: { color: '#91a8ba', fontSize: 11, marginTop: 4, textAlign: 'right' }, arrow: { color: '#62d8cd', fontSize: 26 },
  remote: { backgroundColor: '#122b40', borderRadius: 22, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#28516a' },
  remoteBrand: { color: '#6edbd1', fontWeight: '900', letterSpacing: 2, textAlign: 'center' }, remoteModel: { color: '#dce8f2', textAlign: 'center', fontSize: 12, marginTop: 5 },
  screen: { backgroundColor: '#c7ddc8', borderRadius: 12, padding: 16, marginTop: 18, alignItems: 'center' }, screenLabel: { color: '#47634b', fontSize: 9, letterSpacing: 2 }, temp: { color: '#203d2b', fontSize: 48, fontWeight: '900' }, screenMode: { color: '#47634b', fontSize: 12 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 16 }, control: { backgroundColor: '#254b65', width: 58, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, controlText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  modes: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 }, mode: { paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#1b3a50', borderRadius: 20 }, modeSelected: { backgroundColor: '#397e80' }, modeText: { color: '#f3fbff', fontSize: 11, fontWeight: '700' },
  warning: { color: '#f5ca83', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 15 },
  updateCard: { backgroundColor: '#102438', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1b3449' },
  updateBadge: { color: '#65d9ce', fontSize: 10, fontWeight: '800', textAlign: 'right' }, cardTitle: { color: '#f2f7fc', fontSize: 15, fontWeight: '800', textAlign: 'right', marginTop: 8 },
  footer: { color: '#61798d', textAlign: 'center', fontSize: 10, marginTop: 28 }
});
