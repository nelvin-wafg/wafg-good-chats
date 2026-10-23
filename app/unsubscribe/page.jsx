import { verifyUnsubscribeToken, maskEmail } from '@/lib/unsubscribe';
import UnsubscribeForm from './UnsubscribeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unsubscribe · Good Chats', robots: { index: false, follow: false } };

// /unsubscribe?t=<signed token>
// shows who the link is for and asks for one click. it never unsubscribes on load (email
// scanners open every link), only when the button is pressed.
export default function UnsubscribePage({ searchParams }) {
  const token = typeof searchParams?.t === 'string' ? searchParams.t : '';
  let email = null;
  try {
    email = verifyUnsubscribeToken(token);
  } catch {
    email = null;
  }

  if (!email) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="max-w-md text-center">
          <div className="display text-4xl mb-3">that link<br />isn't valid.</div>
          <p className="text-neutral-600 mb-6">
            [it may have been cut off when copied. open the unsubscribe link from the email again, or reply to the email and we'll take care of it.]
          </p>
          <a href="/" className="text-sm underline">back home</a>
        </div>
      </main>
    );
  }

  return <UnsubscribeForm token={token} maskedEmail={maskEmail(email)} />;
}
