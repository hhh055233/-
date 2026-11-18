import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = 'https://shalat-api.onrender.com';
const TOKEN_KEY = 'shalat.tadiran.refresh-token';

type TadiranDevice = {
  id: string;
  name: string;
  modelId: string;
  model: string;
  supported: boolean;
  online: boolean | null;
  power: boolean | null;
  mode: string | null;
  temperature: number | null;
  currentTemperature: number | null;
  fanSpeed: string | null;
};

type ApiResult = {
  error?: string;
  code?: string;
  session?: string;
  refreshToken?: string;
  devices?: TadiranDevice[];
  note?: string;
};

async function postJson(path: string, body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json() as ApiResult;
  if (!response.ok) {
    const error = new Error(result.error || 'הבקשה נכשלה') as Error & { code?: string; status?: number };
    error.code = result.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

function labelMode(mode: string | null): string {
  const labels: Record<string, string> = {
    COOL: 'קירור', HEAT: 'חימום', DRY: 'ייבוש', FAN: 'אוורור', AUTO: 'אוטומטי'
  };
  return mode ? labels[mode] || mode : 'לא ידוע';
}

function labelFan(speed: string | null): string {
  const labels: Record<string, string> = {
    LOW: 'נמוכה', MEDIUM: 'בינונית', HIGH: 'גבוהה', AUTO: 'אוטומטית'
  };
  return speed ? labels[speed] || speed : 'לא ידועה';
}

export default function TadiranWifiPanel() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [flowSession, setFlowSession] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [devices, setDevices] = useState<TadiranDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('התחברו לחשבון MY TADIRAN כדי לגלות מזגנים תומכים');
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  async function refreshDevices(tokenOverride?: string) {
    const token = tokenOverride || refreshToken || await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    setBusy(true);
    try {
      const result = await postJson('/api/wifi/tadiran/devices', { refreshToken: token });
      const nextToken = result.refreshToken || token;
      await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
      setRefreshToken(nextToken);
      setDevices(Array.isArray(result.devices) ? result.devices : []);
      setStatus('החשבון מחובר. הפקודות יופעלו רק בדגמים שנבדקו.');
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'TADIRAN_REAUTH_REQUIRED' || err.code === 'TADIRAN_TOKEN_MISSING') {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setRefreshToken(null);
        setDevices([]);
        setStatus('נדרש להתחבר מחדש לחשבון Tadiran.');
      } else {
        setStatus(err.message || 'לא הצלחנו לטעון את המזגנים.');
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(TOKEN_KEY).then((token) => {
      if (!active || !token) return;
      setRefreshToken(token);
      void refreshDevices(token);
    }).catch(() => {
      if (active) setStatus('לא ניתן לקרוא את פרטי החיבור השמורים במכשיר.');
    });
    return () => { active = false; };
  }, []);

  async function requestCode() {
    const normalized = phone.trim().replace(/\s/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      Alert.alert('מספר טלפון לא תקין', 'יש להזין מספר בפורמט בינלאומי, למשל ‎+972501234567.');
      return;
    }
    setBusy(true);
    try {
      const result = await postJson('/api/wifi/tadiran/start', { phone: normalized });
      setPhone(normalized);
      setFlowSession(result.session || null);
      setStatus('קוד אימות נשלח במסרון. הזינו אותו כאן.');
    } catch (error) {
      Alert.alert('לא נשלח קוד', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!flowSession) return;
    if (!/^\d{4,8}$/.test(otp.trim())) {
      Alert.alert('קוד לא תקין', 'הזינו את הקוד שקיבלתם במסרון.');
      return;
    }
    setBusy(true);
    try {
      const result = await postJson('/api/wifi/tadiran/verify', {
        phone: phone.trim(),
        session: flowSession,
        otp: otp.trim()
      });
      if (!result.refreshToken) throw new Error('לא התקבל מפתח חיבור מהשירות.');
      await SecureStore.setItemAsync(TOKEN_KEY, result.refreshToken);
      setRefreshToken(result.refreshToken);
      setFlowSession(null);
      setOtp('');
      setDevices(Array.isArray(result.devices) ? result.devices : []);
      setStatus('החשבון חובר בהצלחה. בחרו מזגן מהרשימה.');
    } catch (error) {
      Alert.alert('האימות נכשל', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendCommand(device: TadiranDevice, command: Record<string, unknown>) {
    if (!refreshToken || !device.supported) return;
    setBusy(true);
    try {
      const result = await postJson('/api/wifi/tadiran/control', {
        refreshToken,
        deviceId: device.id,
        command
      });
      if (result.refreshToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, result.refreshToken);
        setRefreshToken(result.refreshToken);
      }
      Alert.alert('הפקודה נשלחה', result.note || 'שירות הענן קיבל את הפקודה. בדקו את המזגן עצמו.');
      await refreshDevices(result.refreshToken || refreshToken);
    } catch (error) {
      Alert.alert('הפקודה לא נשלחה', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setRefreshToken(null);
    setDevices([]);
    setFlowSession(null);
    setOtp('');
    setStatus('החיבור הוסר מהמכשיר.');
  }

  return (
    <View style={s.card}>
      <Text style={s.title}>חיבור Wi-Fi • Tadiran</Text>
      <Text style={s.copy}>התחברות מאובטחת לחשבון MY TADIRAN באמצעות קוד SMS. מפתח החיבור נשמר באחסון המאובטח של הטלפון ולא נשמר בשרת SHALAT.</Text>
      <Text style={s.status}>{status}</Text>

      {!refreshToken && !flowSession && <>
        <Text style={s.label}>מספר הטלפון של חשבון MY TADIRAN</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="+972501234567"
          placeholderTextColor="#7892a5"
          keyboardType="phone-pad"
          autoCapitalize="none"
          style={s.input}
          accessibilityLabel="מספר הטלפון של חשבון MY TADIRAN"
        />
        <TouchableOpacity style={s.primary} onPress={requestCode} disabled={busy}>
          <Text style={s.primaryText}>שליחת קוד אימות</Text>
        </TouchableOpacity>
      </>}

      {flowSession && <>
        <Text style={s.label}>קוד האימות שקיבלתם במסרון</Text>
        <TextInput
          value={otp}
          onChangeText={setOtp}
          placeholder="קוד SMS"
          placeholderTextColor="#7892a5"
          keyboardType="number-pad"
          maxLength={8}
          style={s.input}
          accessibilityLabel="קוד אימות SMS"
        />
        <TouchableOpacity style={s.primary} onPress={verifyCode} disabled={busy}>
          <Text style={s.primaryText}>אימות וחיבור החשבון</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondary} onPress={() => { setFlowSession(null); setOtp(''); }}>
          <Text style={s.secondaryText}>ביטול</Text>
        </TouchableOpacity>
      </>}

      {refreshToken && <>
        <View style={s.row}>
          <Text style={s.label}>המזגנים בחשבון</Text>
          <TouchableOpacity onPress={() => refreshDevices()} disabled={busy}>
            <Text style={s.link}>רענון</Text>
          </TouchableOpacity>
        </View>
        {devices.length === 0 && <Text style={s.copy}>לא נמצאו מזגנים בחשבון, או שהשירות עדיין לא החזיר רשימה.</Text>}
        {devices.map((device) => {
          const open = expandedDevice === device.id;
          return (
            <View key={device.id} style={s.device}>
              <TouchableOpacity onPress={() => setExpandedDevice(open ? null : device.id)}>
                <Text style={s.deviceName}>{device.name}</Text>
                <Text style={s.deviceMeta}>{device.model} • {device.modelId || 'ללא מזהה דגם'}</Text>
                <Text style={s.deviceMeta}>מצב רשת: {device.online === null ? 'לא ידוע' : device.online ? 'מחובר' : 'לא מקוון'}</Text>
                <Text style={[s.support, device.supported ? s.supportYes : s.supportNo]}>
                  {device.supported ? 'דגם שנבדק — שליטה זמינה' : 'הדגם עדיין לא נבדק — שליטה חסומה'}
                </Text>
              </TouchableOpacity>
              {open && device.supported && <>
                <Text style={s.deviceMeta}>מצב: {labelMode(device.mode)} • טמפרטורה: {device.temperature ?? '—'}°C • מאוורר: {labelFan(device.fanSpeed)}</Text>
                <View style={s.controls}>
                  <TouchableOpacity style={s.controlButton} onPress={() => sendCommand(device, { power: true })} disabled={busy}><Text style={s.controlText}>הפעלה</Text></TouchableOpacity>
                  <TouchableOpacity style={s.controlButton} onPress={() => sendCommand(device, { power: false })} disabled={busy}><Text style={s.controlText}>כיבוי</Text></TouchableOpacity>
                </View>
                <Text style={s.label}>מצב פעולה</Text>
                <View style={s.controls}>
                  {(['COOL', 'HEAT', 'DRY', 'FAN', 'AUTO'] as const).map((mode) => (
                    <TouchableOpacity key={mode} style={s.controlButton} onPress={() => sendCommand(device, { mode })} disabled={busy}>
                      <Text style={s.controlText}>{labelMode(mode)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.label}>טמפרטורה</Text>
                <View style={s.controls}>
                  <TouchableOpacity style={s.controlButton} onPress={() => sendCommand(device, { temperature: Math.min(30, (device.temperature ?? 24) + 1) })} disabled={busy}><Text style={s.controlText}>+ מעלה</Text></TouchableOpacity>
                  <Text style={s.temperature}>{device.temperature ?? 24}°C</Text>
                  <TouchableOpacity style={s.controlButton} onPress={() => sendCommand(device, { temperature: Math.max(16, (device.temperature ?? 24) - 1) })} disabled={busy}><Text style={s.controlText}>− מעלה</Text></TouchableOpacity>
                </View>
                <Text style={s.label}>מהירות מאוורר</Text>
                <View style={s.controls}>
                  {(['AUTO', 'LOW', 'MEDIUM', 'HIGH'] as const).map((fanSpeed) => (
                    <TouchableOpacity key={fanSpeed} style={s.controlButton} onPress={() => sendCommand(device, { fanSpeed })} disabled={busy}>
                      <Text style={s.controlText}>{labelFan(fanSpeed)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>}
              {open && !device.supported && <Text style={s.copy}>SHALAT לא תשלח פקודות לדגם זה עד שתאומת התאימות שלו. כך נמנעת שליטה לא צפויה במזגן.</Text>}
            </View>
          );
        })}
        <TouchableOpacity style={s.secondary} onPress={disconnect} disabled={busy}>
          <Text style={s.secondaryText}>ניתוק חשבון Tadiran מהמכשיר</Text>
        </TouchableOpacity>
      </>}

      {busy && <View style={s.loading}><ActivityIndicator color="#68dcd1" /><Text style={s.deviceMeta}>מתחבר לשירות…</Text></View>}
      <Text style={s.footnote}>החיבור משתמש בשירות ענן לא רשמי שנחקר בקוד פתוח. נבדקו רק משפחות דגמים מסוימות; SHALAT לא יכולה להבטיח שליטה בדגם שלא נבדק פיזית.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#102438', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2a5864' },
  title: { color: '#f2f7fc', fontSize: 17, fontWeight: '900', textAlign: 'right' },
  copy: { color: '#9cb0c2', fontSize: 12, lineHeight: 19, textAlign: 'right', marginTop: 9 },
  status: { color: '#69dcd2', fontSize: 12, lineHeight: 19, textAlign: 'right', marginTop: 12 },
  label: { color: '#d5e6f1', fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 13 },
  input: { backgroundColor: '#071827', color: '#f4f8ff', borderWidth: 1, borderColor: '#31566b', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, marginTop: 7, textAlign: 'right', minHeight: 46 },
  primary: { backgroundColor: '#4bd5c4', borderRadius: 11, padding: 13, minHeight: 46, justifyContent: 'center', marginTop: 12 },
  primaryText: { color: '#06202a', textAlign: 'center', fontWeight: '900' },
  secondary: { borderWidth: 1, borderColor: '#426175', borderRadius: 10, padding: 11, minHeight: 44, justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: '#c6d8e7', textAlign: 'center', fontWeight: '700' },
  link: { color: '#69dcd2', fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  device: { backgroundColor: '#0b1c2a', borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#28495c' },
  deviceName: { color: '#fff', fontSize: 15, fontWeight: '900', textAlign: 'right' },
  deviceMeta: { color: '#9cb0c2', fontSize: 11, lineHeight: 18, textAlign: 'right', marginTop: 5 },
  support: { fontSize: 11, fontWeight: '800', textAlign: 'right', marginTop: 7 },
  supportYes: { color: '#68dcae' },
  supportNo: { color: '#e6bd72' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 8 },
  controlButton: { backgroundColor: '#1b4960', borderRadius: 9, paddingVertical: 10, paddingHorizontal: 11, minHeight: 42, justifyContent: 'center' },
  controlText: { color: '#f4f8ff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  temperature: { color: '#fff', fontSize: 17, fontWeight: '900', paddingHorizontal: 8 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  footnote: { color: '#718da1', fontSize: 10, lineHeight: 16, textAlign: 'right', marginTop: 14 }
});
