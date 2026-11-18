const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePhone,
  validateOtp,
  normalizeDevices,
  validateCommand,
  TESTED_MODEL_IDS
} = require("./tadiran-wifi");

test("accepts international phone numbers and rejects malformed values", () => {
  assert.equal(validatePhone("+972501234567"), true);
  assert.equal(validatePhone("0501234567"), false);
  assert.equal(validatePhone("+972 50 123 4567"), false);
  assert.equal(validatePhone(""), false);
});

test("validates short-lived SMS codes", () => {
  assert.equal(validateOtp("123456"), true);
  assert.equal(validateOtp("12a456"), false);
  assert.equal(validateOtp("123"), false);
});

test("normalizes device data and marks only the documented model allowlist as supported", () => {
  const devices = normalizeDevices([
    {
      device_id: "device-1",
      name: "Living room",
      model_id: "hyfpizc9xabvyyl3",
      description: "Ducted Inverter",
      configurations: { online: "true", power: true, temp_set: 240, temp_current: 255, mode: "COOL" }
    },
    {
      device_id: "device-2",
      name: "Unknown model",
      model_id: "not-tested",
      configurations: { online: false }
    }
  ]);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].supported, true);
  assert.equal(devices[0].temperature, 24);
  assert.equal(devices[0].currentTemperature, 25.5);
  assert.equal(devices[0].online, true);
  assert.equal(devices[1].supported, false);
  assert.equal(TESTED_MODEL_IDS.has("not-tested"), false);
});

test("accepts only supported Tadiran command values", () => {
  assert.deepEqual(validateCommand({ power: true, mode: "cool", temperature: 24, fanSpeed: "auto" }), {
    power: true,
    mode: "COOL",
    temp_set: 24,
    wind_speed: "AUTO"
  });
  assert.throws(() => validateCommand({ temperature: 15 }), /16 ל־30/);
  assert.throws(() => validateCommand({ mode: "HEAT_COOL" }), /מצב הפעולה/);
  assert.throws(() => validateCommand({ swing: true }), /שדה שאינו נתמך/);
});
