/** Original schematic, not experimental observations or a model output. */
export function ResearchIllustration({
  compact = false,
}: {
  compact?: boolean
}) {
  return (
    <div className={`research-illustration ${compact ? "is-compact" : ""}`}>
      <svg
        viewBox="0 0 400 300"
        role="img"
        aria-label="Illustrative water maze trajectory, not measured experimental data"
      >
        <defs>
          <pattern
            id={compact ? "maze-grid-small" : "maze-grid"}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="currentColor"
              strokeOpacity=".07"
            />
          </pattern>
        </defs>
        <rect
          width="400"
          height="300"
          fill={`url(#${compact ? "maze-grid-small" : "maze-grid"})`}
        />
        <g fill="none" stroke="currentColor">
          <ellipse cx="200" cy="160" rx="129" ry="101" opacity=".08" />
          <circle cx="200" cy="144" r="103" strokeOpacity=".35" />
          <circle
            cx="200"
            cy="144"
            r="92"
            strokeDasharray="2 6"
            strokeOpacity=".13"
          />
          <path
            d="M97 144h206M200 41v206"
            strokeOpacity=".1"
            strokeDasharray="4 5"
          />
          <circle
            cx="243"
            cy="99"
            r="15"
            strokeOpacity=".4"
            strokeDasharray="3 4"
          />
          <path
            className="research-trajectory"
            d="M132 210C97 171 124 87 162 77S274 65 282 125 246 217 209 215 133 173 148 133 223 101 246 126 216 184 185 165 175 111 207 109 225 121 243 99"
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <circle cx="132" cy="210" r="4" fill="var(--brand)" />
        <circle cx="243" cy="99" r="4" fill="var(--brand)" />
        <g
          fontSize="9"
          fill="currentColor"
          opacity=".45"
          fontFamily="monospace"
          letterSpacing="1"
        >
          <text x="24" y="28">
            OBSERVE / TRACE / UNDERSTAND
          </text>
          <text x="24" y="278">
            SCHEMATIC
          </text>
          <text x="306" y="278">
            LING SIGHT
          </text>
        </g>
      </svg>
    </div>
  )
}
