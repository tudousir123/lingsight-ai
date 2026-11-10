import { Pause, Play } from "lucide-react"
import { useState } from "react"
import "./institution-marquee.css"

// Visual examples selected by the user, not a list of customers or partners.
const institutions = [
  { name: "Yale University", wordmark: "Yale", style: "yale" },
  {
    name: "Massachusetts Institute of Technology",
    wordmark: "MIT",
    detail: "Massachusetts\nInstitute of\nTechnology",
    style: "mit",
  },
  { name: "Stanford University", wordmark: "Stanford", style: "stanford" },
  {
    name: "Tsinghua University",
    wordmark: "Tsinghua",
    detail: "UNIVERSITY",
    style: "university",
  },
  {
    name: "Harvard University",
    wordmark: "HARVARD",
    detail: "UNIVERSITY",
    style: "harvard",
  },
  {
    name: "Peking University",
    wordmark: "Peking",
    detail: "UNIVERSITY",
    style: "university",
  },
  {
    name: "Princeton University",
    wordmark: "PRINCETON",
    detail: "UNIVERSITY",
    style: "princeton",
  },
  { name: "ETH Zürich", wordmark: "ETH", detail: "zürich", style: "eth" },
  {
    name: "Zhejiang University",
    wordmark: "Zhejiang",
    detail: "UNIVERSITY",
    style: "university",
  },
  {
    name: "The University of Tokyo",
    wordmark: "Tokyo",
    detail: "THE UNIVERSITY OF TOKYO",
    style: "university",
  },
] as const

export function InstitutionMarquee() {
  const [paused, setPaused] = useState(false)

  return (
    <section
      className="institution-section"
      aria-labelledby="institution-heading"
    >
      <div className="institution-heading-row">
        <h2 id="institution-heading">For researchers around the world</h2>
        <button
          type="button"
          className="institution-motion-toggle"
          onClick={() => setPaused((value) => !value)}
          aria-label={
            paused ? "Resume institution marquee" : "Pause institution marquee"
          }
          aria-pressed={paused}
          aria-controls="institution-track"
        >
          {paused ? (
            <Play size={13} aria-hidden />
          ) : (
            <Pause size={13} aria-hidden />
          )}
          <span>{paused ? "Resume" : "Pause"}</span>
        </button>
      </div>
      <div className="institution-viewport" data-paused={paused}>
        <div className="institution-track" id="institution-track">
          {[false, true].map((duplicate) => (
            <ul
              className="institution-group"
              key={String(duplicate)}
              aria-hidden={duplicate || undefined}
            >
              {institutions.map((institution) => (
                <li
                  key={institution.name}
                  className={`institution-name institution-name--${institution.style}`}
                >
                  <span className="sr-only">{institution.name}</span>
                  <span className="institution-wordmark" aria-hidden>
                    {institution.wordmark}
                  </span>
                  {"detail" in institution && (
                    <span className="institution-detail" aria-hidden>
                      {institution.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  )
}
