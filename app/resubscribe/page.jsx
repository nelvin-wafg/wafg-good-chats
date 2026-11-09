import { verifyResubscribeToken } from '@/lib/resubscribe';
import { maskEmail } from '@/lib/unsubscribe';
import ResubscribeForm from './ResubscribeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rejoin the list · good chats', robots: { index: false, follow: false } };

// /resubscribe?t=<signed token>
// shows who the link is for and asks for one click. it never changes anything on load (email
// scanners open every link), only when the button is pressed.
export default function ResubscribePage({ searchParams }) {
  const token = typeof searchParams?.t === 'string' ? searchParams.t : '';
  let email = null;
  try { email = verifyResubscribeToken(token); } catch { email = null; }

  if (!email) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="max-w-md text-center">
          <div className="display text-4xl mb-3">That link<br />isn't valid.</div>
          <p className="text-neutral-600 mb-6">[It may have expired (links last 7 days) or been cut off when copied. Fill in the sign-up form again and we'll send a fresh one.]</p>
          <a href="/" className="text-sm underline">Back home</a>
        </div>
      </main>
    );
  }
  return <ResubscribeForm token={token} maskedEmail={maskEmail(email)} />;
}
