/** The Voicematics mark: a V drawn by sound bars. The same shape as the favicon and the app icon. */
export function BrandMark({ className = 'size-7', gradientId = 'brand-bar' }: { className?: string; gradientId?: string }) {
  const heights = [250, 350, 450, 540, 450, 350, 250];
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF3333" />
          <stop offset="1" stopColor="#FF7A1A" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill="#1a1411" />
      <g fill={`url(#${gradientId})`}>
        {heights.map((height, index) => (
          <rect key={index} x={138 + index * 112} y={242} width={76} height={height} rx={38} />
        ))}
      </g>
    </svg>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';
  // A stable hue per name, kept inside the site's warm range.
  const hue = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 40;
  const sizes = { sm: 'size-7 text-xs', md: 'size-10 text-sm', lg: 'size-20 text-2xl' } as const;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-display font-bold text-obsidian ring-2 ring-white/10 ${sizes[size]}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 100% 60%), hsl(${hue + 24} 100% 52%))` }}
    >
      {initials}
    </span>
  );
}
