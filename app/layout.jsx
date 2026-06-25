import './globals.css';
import { Archivo_Black, Inter, Caveat } from 'next/font/google';
import ToastHost from '@/components/Toast';

const archivo = Archivo_Black({ weight: '400', subsets: ['latin'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const caveat = Caveat({ weight: ['500', '700'], subsets: ['latin'], variable: '--font-script' });

export const metadata = {
  title: 'Good Chats · We Are For Good',
  description: 'Good Chats. seven minutes at a time.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#000000',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${caveat.variable}`}>
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
