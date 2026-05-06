'use client';
import { useEffect, useState } from 'react';

// tiny pubsub-based toast system. import showToast() from anywhere to surface
// inline error/info messages. ToastHost is mounted once in the root layout.
const listeners = new Set();
let _id = 0;

export function showToast(message, type = 'info') {
  const id = ++_id;
  for (const l of listeners) l({ id, message, type });
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function add(toast) {
      setToasts((ts) => [...ts, toast]);
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), 4500);
    }
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="px-4 py-3 rounded-md shadow-lg text-sm font-medium max-w-sm pointer-events-auto border-2 border-black"
          style={{
            background: t.type === 'error' ? '#fca5a5' : t.type === 'success' ? '#01ecf3' : '#fff',
            color: '#000',
            boxShadow: '4px 4px 0 #000',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
