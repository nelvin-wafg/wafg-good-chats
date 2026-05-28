import Link from 'next/link';

export default function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8" style={{ background: '#f4f4f1' }}>
      <div className="max-w-xl text-center">
        <div className="display text-6xl md:text-8xl mb-6">
          Good<span style={{ color: '#01ecf3' }}>*</span>Chats
        </div>
        <p className="text-lg text-neutral-600 mb-8">
          a we are for good thing. five-minute conversations, on purpose.
        </p>
        <p className="text-sm text-neutral-500 mb-12">
          [need a code? ask whoever invited you · or wait for the link to drop in your inbox]
        </p>
        <Link
          href="/host/login"
          className="inline-block btn-cyan px-8 py-4 text-lg rounded-md no-underline"
        >
          host login *
        </Link>
      </div>
    </main>
  );
}
