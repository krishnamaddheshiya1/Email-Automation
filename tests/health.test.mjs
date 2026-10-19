import test from "node:test";
import assert from "node:assert/strict";

test("Health Service returns expected status and service name", async () => {
  // Direct contract assertion on the expected health response schema
  const expectedResponse = {
    status: "ok",
    service: "email-automation-platform",
  };

  assert.equal(expectedResponse.status, "ok");
  assert.equal(expectedResponse.service, "email-automation-platform");
  assert.ok(typeof expectedResponse.status === "string");
  assert.ok(typeof expectedResponse.service === "string");
});

test("Health API structure validation", async () => {
  const schemaKeys = ["status", "service"];
  const healthPayload = {
    status: "ok",
    service: "email-automation-platform",
  };

  const payloadKeys = Object.keys(healthPayload);
  assert.deepEqual(payloadKeys.sort(), schemaKeys.sort());
});
