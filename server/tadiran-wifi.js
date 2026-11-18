"use strict";

const COGNITO_URL = "https://cognito-idp.eu-west-1.amazonaws.com/";
const COGNITO_CLIENT_ID = "312eed498hlvku8pdup0lvfpir";
const TADIRAN_BASE_URL = "https://api.tadiran-iot.co.il";
const ORG_ID_IL = "tenant-f365f952-9143-4004-95b6-5042aed5b7cd";
const ORG_ID_EU = "tenant-a978a082-5052-47ff-baa3-9514a14699cd";

// These are the only model families reported as tested by the referenced
// community integration. Unknown models can be listed but cannot receive commands.
const TESTED_MODEL_IDS = new Set([
  "hyfpizc9xabvyyl3",
  "tadiran-slim-inv-g",
  "alpha-pro-inv-ng",
  "supreme-inv-ng-airow"
]);

class TadiranWifiError extends Error {
  constructor(message, status = 502, code = "TADIRAN_WIFI_ERROR") {
    super(message);
    this.name = "TadiranWifiError";
    this.status = status;
    this.code = code;
  }
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { throw new TadiranWifiError("The air-conditioner service returned an unreadable response."); }
}

async function cognito(target, body) {
  let response;
  try {
    response = await fetch(COGNITO_URL, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService." + target
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new TadiranWifiError("לא הצלחנו להגיע לשירות ההתחברות של Tadiran.", 502, "TADIRAN_NETWORK_ERROR");
  }
  const data = await readJson(response);
  if (!response.ok) {
    const type = String(data?.__type || "");
    if (type.includes("CodeMismatch") || type.includes("ExpiredCode")) {
      throw new TadiranWifiError("קוד האימות שגוי או שפג תוקפו.", 400, "TADIRAN_INVALID_OTP");
    }
    if (type.includes("LimitExceeded") || type.includes("TooManyRequests")) {
      throw new TadiranWifiError("נשלחו יותר מדי בקשות. יש להמתין ולנסות שוב.", 429, "TADIRAN_RATE_LIMIT");
    }
    throw new TadiranWifiError("Tadiran דחתה את בקשת האימות. בדקו את מספר הטלפון ונסו שוב.", 401, "TADIRAN_AUTH_FAILED");
  }
  return data || {};
}

function validatePhone(phone) {
  return typeof phone === "string" && /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

function validateOtp(otp) {
  return typeof otp === "string" && /^\d{4,8}$/.test(otp.trim());
}

async function initiateOtp(phone) {
  if (!validatePhone(phone)) {
    throw new TadiranWifiError("יש להזין מספר טלפון בינלאומי, למשל ‎+972…", 400, "INVALID_PHONE");
  }
  const result = await cognito("InitiateAuth", {
    ClientId: COGNITO_CLIENT_ID,
    AuthFlow: "CUSTOM_AUTH",
    AuthParameters: { USERNAME: phone.trim() }
  });
  if (typeof result.Session !== "string" || !result.Session) {
    throw new TadiranWifiError("Tadiran לא החזירה בקשת אימות תקינה.");
  }
  return { session: result.Session };
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function deriveOrgId(idToken) {
  const claims = decodeJwtPayload(idToken);
  const email = String(claims.email || "");
  const tenant = email.match(/tenant-[a-f0-9-]{36}/i);
  if (tenant) return tenant[0];
  return claims["custom:region"] === "eu" ? ORG_ID_EU : ORG_ID_IL;
}

function tokenExpiry(idToken) {
  const exp = Number(decodeJwtPayload(idToken).exp || 0);
  return Number.isFinite(exp) ? exp : 0;
}

async function verifyOtp(phone, session, otp) {
  if (!validatePhone(phone) || typeof session !== "string" || session.length < 20 || session.length > 10000 || !validateOtp(otp)) {
    throw new TadiranWifiError("פרטי האימות אינם תקינים. התחילו שוב את תהליך החיבור.", 400, "INVALID_OTP_REQUEST");
  }

  let result = await cognito("RespondToAuthChallenge", {
    ClientId: COGNITO_CLIENT_ID,
    ChallengeName: "CUSTOM_CHALLENGE",
    Session: session,
    ChallengeResponses: { USERNAME: phone.trim(), ANSWER: otp.trim() }
  });

  for (let attempt = 0; attempt < 3 && result?.ChallengeName && !result?.AuthenticationResult; attempt += 1) {
    result = await cognito("RespondToAuthChallenge", {
      ClientId: COGNITO_CLIENT_ID,
      ChallengeName: result.ChallengeName,
      Session: result.Session,
      ChallengeResponses: { USERNAME: phone.trim(), ANSWER: otp.trim() }
    });
  }

  const auth = result?.AuthenticationResult;
  if (!auth?.RefreshToken || !auth?.IdToken || !auth?.AccessToken) {
    throw new TadiranWifiError("האימות לא הושלם. נסו לבקש קוד חדש.", 401, "TADIRAN_AUTH_FAILED");
  }

  const tokens = {
    refreshToken: auth.RefreshToken,
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    orgId: deriveOrgId(auth.IdToken)
  };
  const devices = await listDevicesWithTokens(tokens);
  return { refreshToken: tokens.refreshToken, devices };
}

async function refreshTokens(refreshToken) {
  if (typeof refreshToken !== "string" || refreshToken.length < 20 || refreshToken.length > 10000) {
    throw new TadiranWifiError("חסר מפתח חיבור תקין. התחברו מחדש לחשבון Tadiran.", 401, "TADIRAN_TOKEN_MISSING");
  }
  const result = await cognito("InitiateAuth", {
    ClientId: COGNITO_CLIENT_ID,
    AuthFlow: "REFRESH_TOKEN_AUTH",
    AuthParameters: { REFRESH_TOKEN: refreshToken }
  });
  const auth = result?.AuthenticationResult;
  if (!auth?.IdToken || !auth?.AccessToken) {
    throw new TadiranWifiError("פג תוקף החיבור. יש להתחבר מחדש לחשבון Tadiran.", 401, "TADIRAN_REAUTH_REQUIRED");
  }
  return {
    refreshToken: auth.RefreshToken || refreshToken,
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    orgId: deriveOrgId(auth.IdToken)
  };
}

async function tadiranRequest(tokens, method, endpoint, body) {
  const headers = {
    Authorization: "Bearer " + tokens.accessToken,
    idtoken: tokens.idToken,
    organizationid: tokens.orgId,
    Accept: "application/json"
  };
  const options = {
    method,
    signal: AbortSignal.timeout(18000),
    headers
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(TADIRAN_BASE_URL + endpoint, options);
  } catch {
    throw new TadiranWifiError("לא הצלחנו לתקשר עם שרת Tadiran. נסו שוב מאוחר יותר.", 502, "TADIRAN_NETWORK_ERROR");
  }
  if (response.status === 401) {
    throw new TadiranWifiError("פג תוקף ההרשאה. התחברו מחדש לחשבון Tadiran.", 401, "TADIRAN_REAUTH_REQUIRED");
  }
  if (!response.ok) {
    throw new TadiranWifiError("Tadiran לא אישרה את הפעולה. בדקו שהמזגן מחובר לרשת ונסו שוב.", 502, "TADIRAN_API_REJECTED");
  }
  if (response.status === 204) return null;
  return readJson(response);
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function normalizeTemperature(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 60 ? number / 10 : number;
}

function normalizeDevices(payload) {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.devices) ? payload.devices
        : Array.isArray(payload?.results) ? payload.results : [];
  return list.map((device) => {
    const config = device?.configurations && typeof device.configurations === "object" ? device.configurations : {};
    const modelId = String(device?.model_id || device?.modelId || "");
    const deviceId = String(device?.device_id || device?.deviceId || device?.id || "");
    if (!deviceId) return null;
    return {
      id: deviceId,
      name: String(device?.name || device?.friendly_name || "מזגן Tadiran"),
      modelId,
      model: String(device?.description || device?.model || modelId || "דגם לא ידוע"),
      supported: TESTED_MODEL_IDS.has(modelId),
      online: config.online === undefined ? null : normalizeBoolean(config.online),
      power: config.power === undefined ? null : normalizeBoolean(config.power),
      mode: typeof config.mode === "string" ? config.mode.toUpperCase() : null,
      temperature: normalizeTemperature(config.temp_set),
      currentTemperature: normalizeTemperature(config.temp_current),
      fanSpeed: typeof config.wind_speed === "string" ? config.wind_speed.toUpperCase() : null
    };
  }).filter(Boolean);
}

async function listDevicesWithTokens(tokens) {
  const payload = await tadiranRequest(tokens, "GET", "/tadiran-mobile-app/api/v1/devices/");
  return normalizeDevices(payload);
}

async function listDevices(refreshToken) {
  const tokens = await refreshTokens(refreshToken);
  const devices = await listDevicesWithTokens(tokens);
  return { refreshToken: tokens.refreshToken, devices };
}

function validateCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new TadiranWifiError("הפקודה אינה תקינה.", 400, "INVALID_COMMAND");
  }
  const allowed = new Set(["power", "mode", "temperature", "fanSpeed"]);
  const keys = Object.keys(command);
  if (!keys.length || keys.some((key) => !allowed.has(key))) {
    throw new TadiranWifiError("הפקודה כוללת שדה שאינו נתמך.", 400, "INVALID_COMMAND");
  }
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(command, "power")) {
    if (typeof command.power !== "boolean") throw new TadiranWifiError("ערך ההפעלה אינו תקין.", 400, "INVALID_COMMAND");
    updates.power = command.power;
  }
  if (Object.prototype.hasOwnProperty.call(command, "mode")) {
    const mode = String(command.mode).toUpperCase();
    if (!["COOL", "HEAT", "DRY", "FAN", "AUTO"].includes(mode)) throw new TadiranWifiError("מצב הפעולה אינו נתמך.", 400, "INVALID_COMMAND");
    updates.mode = mode;
  }
  if (Object.prototype.hasOwnProperty.call(command, "temperature")) {
    const temp = Number(command.temperature);
    if (!Number.isInteger(temp) || temp < 16 || temp > 30) throw new TadiranWifiError("הטמפרטורה חייבת להיות בין 16 ל־30 מעלות.", 400, "INVALID_COMMAND");
    updates.temp_set = temp;
  }
  if (Object.prototype.hasOwnProperty.call(command, "fanSpeed")) {
    const speed = String(command.fanSpeed).toUpperCase();
    if (!["LOW", "MEDIUM", "HIGH", "AUTO"].includes(speed)) throw new TadiranWifiError("מהירות המאוורר אינה נתמכת.", 400, "INVALID_COMMAND");
    updates.wind_speed = speed;
  }
  return updates;
}

async function controlDevice(refreshToken, deviceId, command) {
  if (typeof deviceId !== "string" || !deviceId || deviceId.length > 256) {
    throw new TadiranWifiError("לא נבחר מזגן תקין.", 400, "INVALID_DEVICE");
  }
  const updates = validateCommand(command);
  const tokens = await refreshTokens(refreshToken);
  const devices = await listDevicesWithTokens(tokens);
  const device = devices.find((item) => item.id === deviceId);
  if (!device) throw new TadiranWifiError("המזגן לא נמצא בחשבון Tadiran המחובר.", 404, "DEVICE_NOT_FOUND");
  if (!device.supported) {
    throw new TadiranWifiError("הדגם הזה עדיין לא נמצא ברשימת הדגמים שנבדקו. לא נשלחה אליו פקודה.", 409, "MODEL_NOT_VERIFIED");
  }
  await tadiranRequest(tokens, "PUT", "/mobile-app/api/v1/devices/" + encodeURIComponent(deviceId) + "/shadow/update/", Object.entries(updates).map(([name, value]) => ({ name, value })));
  return {
    refreshToken: tokens.refreshToken,
    acceptedByCloud: true,
    device: { id: device.id, name: device.name, modelId: device.modelId },
    note: "הפקודה התקבלה על ידי שירות הענן. מצב המזגן עצמו עשוי להתעדכן באיחור."
  };
}

module.exports = {
  TadiranWifiError,
  validatePhone,
  validateOtp,
  initiateOtp,
  verifyOtp,
  listDevices,
  controlDevice,
  normalizeDevices,
  validateCommand,
  TESTED_MODEL_IDS
};
