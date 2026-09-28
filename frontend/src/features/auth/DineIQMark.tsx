/**
 * DineIQMark — the product logomark. An amber→orange signal line inside a
 * dark rounded square; no external imagery required.
 */
export function DineIQMark({
  size = 32,
  pulse = false,
}: {
  size?: number
  pulse?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="DineIQ Analytics"
      className={pulse ? 'animate-pulse' : undefined}
    >
      <defs>
        <linearGradient id="dineiq-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0B1020" />
      <rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke="url(#dineiq-g)" strokeWidth="1.5" />
      <path
        d="M8 21.5 L13 15 L17 18.5 L24 10"
        fill="none"
        stroke="url(#dineiq-g)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="10" r="2.2" fill="#F59E0B" />
    </svg>
  )
}
