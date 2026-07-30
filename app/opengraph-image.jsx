import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Good Chats · We Are For Good';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px 100px',
          fontFamily: 'Arial Black, sans-serif',
        }}
      >
        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0px' }}>
          <span style={{ fontSize: '96px', fontWeight: 900, color: '#fff', letterSpacing: '-3px', lineHeight: 1 }}>
            good
          </span>
          <span style={{ fontSize: '96px', fontWeight: 900, color: '#01ecf3', letterSpacing: '-3px', lineHeight: 1 }}>
            *
          </span>
          <span style={{ fontSize: '96px', fontWeight: 900, color: '#fff', letterSpacing: '-3px', lineHeight: 1 }}>
            chats
          </span>
        </div>

        {/* tagline */}
        <div style={{ marginTop: '24px', fontSize: '32px', color: '#999', fontWeight: 400, fontFamily: 'Arial, sans-serif' }}>
          seven minutes at a time.
        </div>

        {/* cyan accent bar */}
        <div style={{
          position: 'absolute',
          bottom: '0',
          left: '0',
          width: '1200px',
          height: '8px',
          background: '#01ecf3',
        }} />

        {/* wafg credit */}
        <div style={{
          position: 'absolute',
          bottom: '28px',
          right: '100px',
          fontSize: '22px',
          color: '#555',
          fontFamily: 'Arial, sans-serif',
        }}>
          We Are For Good
        </div>
      </div>
    ),
    { ...size }
  );
}
