import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  createCheckoutOrder,
  downloadEbook,
  verifyCheckoutPayment,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowDown, ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  theme: { color: string };
  handler: (response: RazorpayCheckoutResponse) => void;
  modal: { ondismiss: () => void };
};

type RazorpayCheckoutInstance = {
  open: () => void;
  on: (event: 'payment.failed', callback: () => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

type CheckoutPhase =
  | 'idle'
  | 'starting'
  | 'checkout'
  | 'verifying'
  | 'verified'
  | 'downloading'
  | 'error';
type CheckoutState = {
  phase: CheckoutPhase;
  message: string;
  downloadToken?: string;
};

let checkoutScriptPromise: Promise<void> | undefined;

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not load.'));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    checkoutScriptPromise = undefined;
    throw error;
  });

  checkoutScriptPromise = pending;
  return pending;
}

function getCheckoutError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
    ) {
      return data.error;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Checkout could not start. Please try again.';
}

function Home() {
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    phase: 'idle',
    message: '',
  });
  const checkoutBusy = ['starting', 'checkout', 'verifying', 'downloading'].includes(checkoutState.phase);
  const feedbackMessage =
    checkoutState.message ||
    'Razorpay Test Mode is the default. Test payments do not release the real ebook.';
  const feedbackClass =
    checkoutState.phase === 'verified'
      ? 'checkout-feedback checkout-success'
      : checkoutState.phase === 'error'
        ? 'checkout-feedback checkout-error'
        : 'checkout-feedback';

  const startCheckout = async () => {
    if (checkoutBusy) return;

    setCheckoutState({
      phase: 'starting',
      message: 'Preparing secure Razorpay Test Mode checkout…',
    });

    try {
      const order = await createCheckoutOrder();
      setCheckoutState({
        phase: 'starting',
        message: order.testMode
          ? 'Opening secure Razorpay Test Mode checkout…'
          : 'Opening secure Razorpay checkout…',
      });
      await loadRazorpayCheckout();

      if (!window.Razorpay) {
        throw new Error('Razorpay Checkout did not load. Please try again.');
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'The Book That Waited for You',
        description: order.testMode
          ? 'Digital thriller ebook · Test Mode'
          : 'Digital thriller ebook',
        order_id: order.orderId,
        theme: { color: '#c6a96b' },
        handler: async (payment) => {
          setCheckoutState({
            phase: 'verifying',
            message: 'Checking the payment directly with Razorpay…',
          });
          try {
            const result = await verifyCheckoutPayment({
              orderId: payment.razorpay_order_id,
              paymentId: payment.razorpay_payment_id,
              signature: payment.razorpay_signature,
            });
            setCheckoutState({
              phase: 'verified',
              message: result.message,
              ...(result.downloadToken
                ? { downloadToken: result.downloadToken }
                : {}),
            });
          } catch (error) {
            setCheckoutState({
              phase: 'error',
              message: getCheckoutError(error),
            });
          }
        },
        modal: {
          ondismiss: () => {
            setCheckoutState((current) =>
              current.phase === 'checkout'
                ? {
                    phase: 'idle',
                    message: 'Checkout closed. No payment was verified and no ebook was released.',
                  }
                : current,
            );
          },
        },
      });

      checkout.on('payment.failed', () => {
        setCheckoutState({
          phase: 'error',
          message: 'Payment did not complete. No payment was verified and no ebook was released.',
        });
      });
      setCheckoutState({
        phase: 'checkout',
        message: 'Razorpay Test Mode checkout is open. No real charge will be made.',
      });
      checkout.open();
    } catch (error) {
      setCheckoutState({
        phase: 'error',
        message: getCheckoutError(error),
      });
    }
  };

  const downloadPurchasedEbook = async () => {
    const token = checkoutState.downloadToken;
    if (!token || checkoutBusy) return;

    setCheckoutState((current) => ({
      ...current,
      phase: 'downloading',
      message: 'Preparing your private ebook download…',
    }));

    try {
      const file = await downloadEbook(
        { token },
        { responseType: 'blob' },
      );
      if (file.size === 0 || file.type !== 'application/pdf') {
        throw new Error('The ebook file could not be downloaded. Please try again.');
      }

      const fileUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = 'The-Book-That-Waited-for-You.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);

      setCheckoutState((current) => ({
        ...current,
        phase: 'verified',
        message: 'Your ebook download has started.',
      }));
    } catch (error) {
      setCheckoutState((current) => ({
        ...current,
        phase: 'error',
        message: getCheckoutError(error),
      }));
    }
  };

  const actionBusy = checkoutBusy;
  const action = checkoutState.downloadToken
    ? downloadPurchasedEbook
    : startCheckout;
  const actionLabel = checkoutState.downloadToken
    ? checkoutState.phase === 'downloading'
      ? 'Preparing…'
      : 'Download Ebook'
    : checkoutBusy
      ? 'Please wait'
      : 'Buy Ebook';

  const checkoutFeedback = (
    <p className={feedbackClass} role="status" aria-live="polite">
      {checkoutState.phase === 'starting' ||
      checkoutState.phase === 'verifying' ||
      checkoutState.phase === 'downloading' ? (
        <LoaderCircle size={14} className="checkout-spinner" aria-hidden="true" />
      ) : checkoutState.phase === 'verified' ? (
        <CheckCircle2 size={14} aria-hidden="true" />
      ) : checkoutState.phase === 'error' ? (
        <AlertCircle size={14} aria-hidden="true" />
      ) : null}
      <span>{feedbackMessage}</span>
    </p>
  );

  return (
    <main className="storefront grain">
      <div className="wrap">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="The Book That Waited for You, home" data-testid="link-home">
            <span className="brand-mark"><span>W</span></span>
            <span>A story in the dark</span>
          </a>
          <span className="nav-note">A thriller ebook · ₹450</span>
        </header>

        <section className="hero" id="top" aria-labelledby="book-title">
          <div className="hero-copy">
            <div className="eyebrow">Some stories find their reader</div>
            <h1 id="book-title">The Book<br />That <em>Waited</em><br />for You</h1>
            <p className="hero-desc">
              There are stories you choose. And then there are the ones that seem to have been <strong>waiting for you all along.</strong>
            </p>
            <div className="buy-row">
              <button className="buy-button" onClick={action} disabled={actionBusy} aria-busy={actionBusy} data-testid="button-buy-now">
                {actionLabel} <ArrowRight size={15} strokeWidth={1.7} />
              </button>
              <div className="price" data-testid="text-book-price">₹450<small>Digital edition</small></div>
            </div>
            {checkoutFeedback}
          </div>
          <div className="cover-stage" data-testid="img-book-cover">
            <div className="orbit" />
            <div className="cover-frame">
              <img src="/book-cover.jpg" alt="Cover of The Book That Waited for You, beneath a star-filled midnight sky" />
            </div>
            <span className="cover-caption">A quiet invitation · 01</span>
          </div>
          <a className="scroll-mark" href="#inside" data-testid="link-discover"><i /><span>Step inside</span><ArrowDown size={12} /></a>
        </section>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {Array.from({ length: 2 }, (_, row) => (
            <span key={row}>A little mystery <b>·</b> A page turned after midnight <b>·</b> The feeling of being found <b>·</b> A story that stays <b>·</b></span>
          ))}
        </div>
      </div>

      <section className="interlude wrap" id="inside">
        <div className="eyebrow">An invitation, not an explanation</div>
        <h2>Somewhere between the first page and the last, the night begins to feel different.</h2>
        <p>For readers who like the unanswered question to linger.</p>
      </section>

      <section className="details">
        <div className="wrap details-grid">
          <div>
            <span className="detail-kicker">Keep the light on</span>
            <h2>A mystery with room<br />for your imagination.</h2>
            <div className="details-copy">
              <p><em>The Book That Waited for You</em> is an atmospheric thriller ebook made for the hush of late hours and the moment you realise you have read one more page than you meant to.</p>
              <p>Its secrets are best left unopened here. The first page is waiting when you are.</p>
            </div>
          </div>
          <div className="note-list" aria-label="Edition details">
            <div className="note-item"><span>The edition</span><span>Digital ebook</span></div>
            <div className="note-item"><span>The mood</span><span>Atmospheric thriller</span></div>
            <div className="note-item"><span>The price</span><span>₹450 · one-time</span></div>
            <div className="note-item"><span>Checkout</span><span>Test Mode by default · live delivery after server verification</span></div>
          </div>
        </div>
      </section>

      <section className="closing wrap" id="edition">
        <div className="eyebrow">When the moment is right</div>
        <h2>It was waiting<br />for you.</h2>
        <p>Digital edition · ₹450</p>
        <div className="buy-row">
          <button className="buy-button" onClick={action} disabled={actionBusy} aria-busy={actionBusy} data-testid="button-buy-now-bottom">
            {actionLabel} <ArrowRight size={15} strokeWidth={1.7} />
          </button>
        </div>
        {checkoutFeedback}
      </section>

      <footer className="wrap footer">
        <span className="footer-title">The Book That Waited for You</span>
        <span>An invitation to turn the page.</span>
        <span>₹450 · Digital edition</span>
      </footer>

    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
