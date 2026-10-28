import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createEbookDownloadToken,
  getConfiguredPaymentMode,
  getPaymentModeForOrderStatus,
  getRazorpayCredentials,
  isVerifiedLiveEbookOrder,
  signatureMatches,
  verifyEbookDownloadToken,
} from "./paymentSecurity.ts";

const testSecret = "local-unit-test-secret-only";

test("checkout defaults to Test Mode and rejects unknown modes", () => {
  assert.equal(getConfiguredPaymentMode({}), "test");
  assert.equal(getConfiguredPaymentMode({ RAZORPAY_MODE: "live" }), "live");
  assert.equal(getConfiguredPaymentMode({ RAZORPAY_MODE: "production" }), null);
});

test("credentials are isolated by mode and key ID prefix", () => {
  const environment = {
    RAZORPAY_KEY_ID: "rzp_test_key",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_LIVE_KEY_ID: "rzp_live_key",
    RAZORPAY_LIVE_KEY_SECRET: "live-secret",
  };

  assert.deepEqual(getRazorpayCredentials("test", environment), {
    keyId: "rzp_test_key",
    keySecret: "test-secret",
  });
  assert.deepEqual(getRazorpayCredentials("live", environment), {
    keyId: "rzp_live_key",
    keySecret: "live-secret",
  });
  assert.equal(
    getRazorpayCredentials("live", {
      ...environment,
      RAZORPAY_LIVE_KEY_ID: "rzp_test_wrong_mode",
    }),
    null,
  );
  assert.equal(
    getRazorpayCredentials("live", {
      ...environment,
      RAZORPAY_LIVE_KEY_SECRET: undefined,
    }),
    null,
  );
});

test("legacy and new test orders can never qualify for live delivery", () => {
  assert.equal(getPaymentModeForOrderStatus("created"), "test");
  assert.equal(getPaymentModeForOrderStatus("created_test"), "test");
  assert.equal(getPaymentModeForOrderStatus("verified_test"), "test");
  assert.equal(getPaymentModeForOrderStatus("created_live"), "live");
  assert.equal(getPaymentModeForOrderStatus("verified_live"), "live");
  assert.equal(getPaymentModeForOrderStatus("unknown"), null);

  const claims = { orderId: "order_1", paymentId: "pay_1", expiresAt: 5_000 };
  for (const status of ["created", "created_test", "verified_test", "created_live"]) {
    assert.equal(
      isVerifiedLiveEbookOrder(
        {
          status,
          amount: 45_000,
          currency: "INR",
          razorpayPaymentId: "pay_1",
          verifiedAt: new Date(1_000),
        },
        claims,
        45_000,
        "INR",
      ),
      false,
    );
  }
});

test("Razorpay payment signatures are compared safely", () => {
  const signature = createHmac("sha256", testSecret)
    .update("order_1|pay_1")
    .digest("hex");

  assert.equal(signatureMatches("order_1", "pay_1", signature, testSecret), true);
  assert.equal(signatureMatches("order_1", "pay_2", signature, testSecret), false);
  assert.equal(signatureMatches("order_1", "pay_1", "not-a-signature", testSecret), false);
});

test("download authorization is signed, expires, and requires a captured Live Mode order", () => {
  const now = 1_000;
  const token = createEbookDownloadToken("order_1", "pay_1", testSecret, now);
  const claims = verifyEbookDownloadToken(token, testSecret, now);

  assert.deepEqual(claims, {
    orderId: "order_1",
    paymentId: "pay_1",
    expiresAt: now + 30 * 60 * 1000,
  });
  assert.equal(verifyEbookDownloadToken(token, "wrong-secret", now), null);
  assert.equal(
    verifyEbookDownloadToken(token, testSecret, now + 30 * 60 * 1000),
    null,
  );
  assert.equal(verifyEbookDownloadToken(`${token}x`, testSecret, now), null);
  assert.equal(claims && isVerifiedLiveEbookOrder(
    {
      status: "verified_live",
      amount: 45_000,
      currency: "INR",
      razorpayPaymentId: "pay_1",
      verifiedAt: new Date(now),
    },
    claims,
    45_000,
    "INR",
  ), true);
});
