/** The hAIul SIM wordmark: "h·AI·ul" with the AI emphasised in the accent, "SIM" as a small cap tag. */
export function Brand({ size = 16, compact }: { size?: number; compact?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', userSelect: 'none' }} aria-label="hAIul SIM">
      <svg width={size + 10} height={size + 10} viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="hs-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3D8BFF" />
            <stop offset="1" stopColor="#0A5FC4" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#hs-g)" />
        <path d="M6.5 20.5h2.6l2.9-6.6h6.6l2.9 3.9h4v2.7" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11.2" cy="22.6" r="2.3" fill="#fff" />
        <circle cx="21.8" cy="22.6" r="2.3" fill="#fff" />
        <path d="M22.6 6.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="#fff" />
      </svg>
      {!compact && (
        <span style={{ fontSize: size, fontWeight: 650, letterSpacing: '-.01em', color: 'var(--ink)', display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span>h<span style={{ color: 'var(--accent)', fontWeight: 800 }}>AI</span>ul</span>
          <span style={{ fontSize: size * 0.62, fontWeight: 700, letterSpacing: '.12em', color: 'var(--ink-3)' }}>SIM</span>
        </span>
      )}
    </span>
  );
}
