import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentMode = "test" | "live";

export type RazorpayCredentials = {
  keyId: string;
  keySecret: string;
};

export type EbookDownloadClaims = {
  orderId: string;
  paymentId: string;
  expiresAt: number;
};

type Environment = Record<string, string | undefined>;

const DOWNLOAD_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

export function getConfiguredPaymentMode(
  environment: Environment = process.env,
): PaymentMode | null {
  const configured = environment.RAZORPAY_MODE ?? "test";
  return configured === "test" || configured === "live" ? configured : null;
}

export function getRazorpayCredentials(
  mode: PaymentMode,
  environment: Environment = process.env,
): RazorpayCredentials | null {
  const keyId =
    mode === "live"
      ? environment.RAZORPAY_LIVE_KEY_ID
      : environment.RAZORPAY_KEY_ID;
  const keySecret =
    mode === "live"
      ? environment.RAZORPAY_LIVE_KEY_SECRET
      : environment.RAZORPAY_KEY_SECRET;
  const requiredPrefix = mode === "live" ? "rzp_live_" : "rzp_test_";

  if (!keyId || !keyId.startsWith(requiredPrefix) || !keySecret) {
    return null;
  }

  return { keyId, keySecret };
}

export function getPaymentModeForOrderStatus(
  status: string,
): PaymentMode | null {
  if (status === "created_live" || status === "verified_live") {
    return "live";
  }

  // "created" is treated as Test Mode for compatibility with older test orders.
  if (
    status === "created" ||
    status === "created_test" ||
    status === "verified_test"
  ) {
    return "test";
  }

  return null;
}

export function signatureMatches(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false;

  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest();
  const provided = Buffer.from(signature, "hex");

  return (
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  );
}

export function createEbookDownloadToken(
  orderId: string,
  paymentId: string,
  keySecret: string,
  now = Date.now(),
): string {
  const claims: EbookDownloadClaims = {
    orderId,
    paymentId,
    expiresAt: now + DOWNLOAD_TOKEN_LIFETIME_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", keySecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function verifyEbookDownloadToken(
  token: string,
  keySecret: string,
  now = Date.now(),
): EbookDownloadClaims | null {
  if (token.length > 2048) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payload, signature] = parts;
  const expected = createHmac("sha256", keySecret)
    .update(payload)
    .digest();
  const provided = Buffer.from(signature, "base64url");

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;

    const claims = parsed as Partial<EbookDownloadClaims>;
    if (
      typeof claims.orderId !== "string" ||
      claims.orderId.length === 0 ||
      typeof claims.paymentId !== "string" ||
      claims.paymentId.length === 0 ||
      typeof claims.expiresAt !== "number" ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.expiresAt <= now
    ) {
      return null;
    }

    return {
      orderId: claims.orderId,
      paymentId: claims.paymentId,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return null;
  }
}

export function isVerifiedLiveEbookOrder(
  order: {
    status: string;
    amount: number;
    currency: string;
    razorpayPaymentId: string | null;
    verifiedAt: Date | null;
  },
  claims: EbookDownloadClaims,
  expectedAmount: number,
  expectedCurrency: string,
): boolean {
  return (
    order.status === "verified_live" &&
    order.amount === expectedAmount &&
    order.currency === expectedCurrency &&
    order.razorpayPaymentId === claims.paymentId &&
    order.verifiedAt instanceof Date
  );
}
