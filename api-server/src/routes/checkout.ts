import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  ebookOrdersTable,
} from "@workspace/db";
import {
  CreateCheckoutOrderResponse,
  DownloadEbookBody,
  VerifyCheckoutPaymentResponse,
  VerifyCheckoutPaymentBody,
  type CheckoutPaymentVerificationInput,
} from "@workspace/api-zod";
import { privateEbookPath } from "../lib/privateEbook";
import {
  createEbookDownloadToken,
  getConfiguredPaymentMode,
  getPaymentModeForOrderStatus,
  getRazorpayCredentials,
  isVerifiedLiveEbookOrder,
  signatureMatches,
  verifyEbookDownloadToken,
  type PaymentMode,
} from "../lib/paymentSecurity";

const router: IRouter = Router();

const EBOOK_AMOUNT = 45_000;
const EBOOK_CURRENCY = "INR";
const RAZORPAY_API = "https://api.razorpay.com/v1";

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
};

type RazorpayPaymentResponse = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
};

async function razorpayFetch<T>(
  path: string,
  credentials: NonNullable<ReturnType<typeof getRazorpayCredentials>>,
  init?: RequestInit,
): Promise<T> {
  const authorization = Buffer.from(
    `${credentials.keyId}:${credentials.keySecret}`,
  ).toString("base64");
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Razorpay returned HTTP ${response.status}`);
  }

  return payload as T;
}

function credentialsError(mode: PaymentMode): string {
  return mode === "test"
    ? "Razorpay Test Mode is not configured. Add a Test Mode Key ID and Key Secret in Replit Secrets."
    : "Razorpay Live Mode is not configured. Add valid Live Mode credentials in Replit Secrets before enabling live checkout.";
}

function unknownPaymentModeError(): string {
  return "Razorpay mode is invalid. Set RAZORPAY_MODE to test or live.";
}

router.post("/checkout/orders", async (req, res): Promise<void> => {
  const mode = getConfiguredPaymentMode();
  if (!mode) {
    res.status(503).json({ error: unknownPaymentModeError() });
    return;
  }

  const credentials = getRazorpayCredentials(mode);
  if (!credentials) {
    res.status(503).json({ error: credentialsError(mode) });
    return;
  }

  const localOrderId = randomUUID();
  try {
    const order = await razorpayFetch<RazorpayOrderResponse>(
      "/orders",
      credentials,
      {
        method: "POST",
        body: JSON.stringify({
          amount: EBOOK_AMOUNT,
          currency: EBOOK_CURRENCY,
          receipt: localOrderId,
          notes: { product: "the-book-that-waited-for-you", mode },
        }),
      },
    );

    if (
      typeof order?.id !== "string" ||
      order.amount !== EBOOK_AMOUNT ||
      order.currency !== EBOOK_CURRENCY
    ) {
      req.log.error("Razorpay returned an unexpected order response");
      res.status(502).json({
        error: "Razorpay did not return the expected ₹450 INR test order.",
      });
      return;
    }

    await db.insert(ebookOrdersTable).values({
      id: localOrderId,
      razorpayOrderId: order.id,
      amount: EBOOK_AMOUNT,
      currency: EBOOK_CURRENCY,
      status: mode === "live" ? "created_live" : "created_test",
    });

    res.status(201).json(
      CreateCheckoutOrderResponse.parse({
        keyId: credentials.keyId,
        orderId: order.id,
        amount: EBOOK_AMOUNT,
        currency: EBOOK_CURRENCY,
        testMode: mode === "test",
      }),
    );
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Could not create Razorpay test order",
    );
    res.status(502).json({
      error:
        mode === "test"
          ? "Could not start Razorpay Test Mode checkout. Check the test credentials and try again."
          : "Could not start Razorpay Live Mode checkout. Check the Live Mode credentials and try again.",
    });
  }
});

router.post("/checkout/verify", async (req, res): Promise<void> => {
  const parsed = VerifyCheckoutPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The payment verification data is invalid." });
    return;
  }

  const input: CheckoutPaymentVerificationInput = parsed.data;
  const [storedOrder] = await db
    .select()
    .from(ebookOrdersTable)
    .where(eq(ebookOrdersTable.razorpayOrderId, input.orderId))
    .limit(1);

  if (!storedOrder) {
    res.status(404).json({ error: "This Razorpay order was not created here." });
    return;
  }

  const mode = getPaymentModeForOrderStatus(storedOrder.status);
  if (!mode) {
    res.status(409).json({ error: "This order has an unsupported payment status." });
    return;
  }

  const credentials = getRazorpayCredentials(mode);
  if (!credentials) {
    res.status(503).json({ error: credentialsError(mode) });
    return;
  }

  if (
    storedOrder.amount !== EBOOK_AMOUNT ||
    storedOrder.currency !== EBOOK_CURRENCY
  ) {
    req.log.error("Stored ebook order does not match the fixed product price");
    res.status(409).json({ error: "The order does not match this ebook." });
    return;
  }

  if (
    !signatureMatches(
      input.orderId,
      input.paymentId,
      input.signature,
      credentials.keySecret,
    )
  ) {
    res.status(400).json({ error: "Razorpay payment signature did not match." });
    return;
  }

  try {
    const payment = await razorpayFetch<RazorpayPaymentResponse>(
      `/payments/${encodeURIComponent(input.paymentId)}`,
      credentials,
    );

    if (
      payment?.id !== input.paymentId ||
      payment.order_id !== input.orderId ||
      payment.amount !== EBOOK_AMOUNT ||
      payment.currency !== EBOOK_CURRENCY
    ) {
      res.status(409).json({
        error: "The payment details do not match this ₹450 ebook order.",
      });
      return;
    }

    if (payment.status !== "captured") {
      res.status(409).json({
        error:
          "Razorpay has not confirmed a captured payment yet. The ebook has not been released.",
      });
      return;
    }

    if (
      (storedOrder.status === "verified_test" ||
        storedOrder.status === "verified_live") &&
      storedOrder.razorpayPaymentId !== input.paymentId
    ) {
      res.status(409).json({
        error: "This test order has already been verified with another payment.",
      });
      return;
    }

    await db
      .update(ebookOrdersTable)
      .set({
        status: mode === "live" ? "verified_live" : "verified_test",
        razorpayPaymentId: input.paymentId,
        verifiedAt: new Date(),
      })
      .where(
        and(
          eq(ebookOrdersTable.id, storedOrder.id),
          eq(ebookOrdersTable.razorpayOrderId, input.orderId),
        ),
      );

    const downloadToken =
      mode === "live"
        ? createEbookDownloadToken(
            input.orderId,
            input.paymentId,
            credentials.keySecret,
          )
        : undefined;

    res.json(
      VerifyCheckoutPaymentResponse.parse({
        verified: true,
        testMode: mode === "test",
        message:
          mode === "test"
            ? "Razorpay Test Mode payment verified. The real ebook PDF is intentionally withheld during testing."
            : "Razorpay Live Mode payment verified. Your private ebook download is available for 30 minutes.",
        ...(downloadToken ? { downloadToken } : {}),
      }),
    );
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
        "Could not confirm Razorpay payment",
    );
    res.status(502).json({
      error:
        "Razorpay could not confirm the payment status. No ebook was released.",
    });
  }
});

router.post("/checkout/download", async (req, res): Promise<void> => {
  const parsed = DownloadEbookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The download authorization is invalid." });
    return;
  }

  const credentials = getRazorpayCredentials("live");
  if (!credentials) {
    res.status(404).json({ error: "This ebook download is not available." });
    return;
  }

  const claims = verifyEbookDownloadToken(
    parsed.data.token,
    credentials.keySecret,
  );
  if (!claims) {
    res.status(404).json({ error: "This ebook download is not available." });
    return;
  }

  const [storedOrder] = await db
    .select()
    .from(ebookOrdersTable)
    .where(
      and(
        eq(ebookOrdersTable.id, claims.orderId),
        eq(ebookOrdersTable.razorpayPaymentId, claims.paymentId),
      ),
    )
    .limit(1);

  if (
    !storedOrder ||
    !isVerifiedLiveEbookOrder(
      storedOrder,
      claims,
      EBOOK_AMOUNT,
      EBOOK_CURRENCY,
    )
  ) {
    res.status(404).json({ error: "This ebook download is not available." });
    return;
  }

  res.set({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/pdf",
  });
  res.download(
    privateEbookPath,
    "The-Book-That-Waited-for-You.pdf",
    (error) => {
      if (error) {
        req.log.error(
          { error: error.message },
          "Private ebook download stream failed",
        );
        if (!res.headersSent) {
          res.status(500).json({
            error: "Could not send the ebook. Please try the download again.",
          });
        }
      }
    },
  );
});

export default router;
