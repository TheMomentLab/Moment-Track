import { useMemo } from "react"

export default function Logo({ className = "w-5 h-5" }: { className?: string }) {
  const maskId = useMemo(() => `planet-mask-${Math.random().toString(36).slice(2)}`, [])

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <mask id={maskId}>
          <rect width="100" height="100" fill="white" />
          <path
            d="M 0,50 A 50,16 0 0,0 100,50"
            fill="none"
            stroke="black"
            strokeWidth="12"
            transform="rotate(-15 50 50)"
          />
        </mask>
      </defs>
      <circle cx="50" cy="50" r="34" mask={`url(#${maskId})`} />
      <ellipse cx="50" cy="50" rx="48" ry="16" transform="rotate(-15 50 50)" />
    </svg>
  )
}
