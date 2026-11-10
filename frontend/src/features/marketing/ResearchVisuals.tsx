import { historicalDaily } from './historical'

export function MazeScene({ compact = false, annotations = true, inference = false, inferenceLayers = ['MASK','HEADING','TRACK'] }: { compact?: boolean; annotations?: boolean; inference?: boolean; inferenceLayers?: string[] }) {
  return (
    <svg viewBox="0 0 720 440" className={'maze-scene ' + (compact ? 'maze-compact' : '')} role="img" aria-label="Water maze trajectory and calibration diagram">
      <defs>
        <radialGradient id="scene-pool"><stop stopColor="#26303a"/><stop offset="1" stopColor="#151a20"/></radialGradient>
        <linearGradient id="scene-track" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#f1efe9" stopOpacity=".32"/><stop offset="1" stopColor="#f1efe9" stopOpacity=".9"/></linearGradient>
      </defs>
      <rect width="720" height="440" rx="12" fill="#111417"/>
      <g stroke="#31353a" strokeWidth=".7" opacity=".55">{Array.from({length:19},(_,i)=><path key={i} d={'M'+(i*40)+',0V440 M0,'+(i*25)+'H720'}/>)}</g>
      <ellipse cx="352" cy="218" rx="235" ry="195" fill="url(#scene-pool)" stroke="#777b7d" strokeWidth="1.3"/>
      <ellipse cx="352" cy="218" rx="221" ry="182" fill="none" stroke="#5c6065" strokeDasharray="3 8"/>
      {(!inference||inferenceLayers.includes('TRACK'))&&<path d="M284 372 C243 362 181 315 196 248 S290 124 328 177 S411 327 471 262 S489 122 393 90 S209 106 244 209 S373 312 424 215 S381 143 344 197 S380 257 436 189" fill="none" stroke="url(#scene-track)" strokeWidth="2.4" strokeLinecap="round"/>}
      <circle cx="436" cy="189" r="4.5" fill="#f7f2e8"/>
      {inference && inferenceLayers.length>0 && <g aria-label="Illustrative mask, heading, and trajectory layers">
        {inferenceLayers.includes('MASK')&&<path d="M421 193 Q420 180 432 176 Q446 171 454 180 Q460 190 447 197 Q432 203 421 193Z" fill="#69d8bd28" stroke="#8ad9c1" strokeWidth="2"/>}
        {inferenceLayers.includes('HEADING')&&<><path d="M437 188 L461 174" stroke="#fa5f29" strokeWidth="2.4" strokeLinecap="round"/><path d="M461 174 L453 175 M461 174 L458 182" fill="none" stroke="#fa5f29" strokeWidth="2" strokeLinecap="round"/></>}
        {inferenceLayers.includes('TRACK')&&<path d="M421 194 L394 208" stroke="#e9e9e9" strokeDasharray="4 5" strokeOpacity=".8"/>}
        <rect x="464" y="150" width="124" height="22" rx="5" fill="#151515" stroke="#3e4843"/>
        <text x="475" y="165" fontSize="11" fontFamily="monospace" fill="#c8e7dc">ACTIVE LAYERS</text>
      </g>}
      {annotations && <>
        <path d="M352 23V413M117 218H587" stroke="#8e9397" strokeWidth=".7" strokeDasharray="5 10" opacity=".35"/>
        <circle cx="474" cy="323" r="20" fill="#fa5f2917" stroke="#fa5f29" strokeWidth="1.4" strokeDasharray="5 5"/>
        <circle cx="474" cy="323" r="3.5" fill="#fa5f29"/>
        <g fill="#efefef" fontSize="20" textAnchor="middle"><text x="352" y="20">★</text><text x="618" y="224">▭</text><text x="352" y="436">△</text><text x="85" y="224">●</text></g>
        <g fill="#94999d" fontSize="10" fontFamily="monospace"><text x="18" y="24">FRAME / 01248</text><text x="17" y="414">2560 × 1440</text><text x="605" y="414">30 FPS</text></g>
      </>}
    </svg>
  )
}

export function TrendChart({ height=240, minimal=false }: {height?:number;minimal?:boolean}) {
  const values=historicalDaily.map(d=>d.targetMarkS)
  const x=(i:number)=>60+i*116
  const y=(v:number)=>188-(v+1)*32
  const line=values.map((v,i)=>(i===0?'M':'L')+x(i)+' '+y(v)).join(' ')
  const area=line+' L'+x(4)+' 220 L'+x(0)+' 220 Z'
  return <svg viewBox="0 0 585 240" style={{width:'100%',height}} role="img" aria-label="Target mark enrichment S, August 4–8, 2026">
    {[-1,0,1,2,3,4,5].map(v=><g key={v}><line x1="52" x2="544" y1={y(v)} y2={y(v)} stroke={v===0?'#565656':'#303030'} strokeDasharray={v===0?'0':'3 6'}/>{!minimal&&<text x="37" y={y(v)+4} fill="#797979" textAnchor="end" fontSize="10">{v}</text>}</g>)}
    <path d={area} fill="#dfdedb" fillOpacity=".045"/><path d={line} fill="none" stroke="#d9d8d6" strokeWidth="2.3"/>
    {values.map((v,i)=><g key={i}><circle cx={x(i)} cy={y(v)} r="4" fill="#f2f0ed" stroke="#151515" strokeWidth="2"/>{!minimal&&<><text x={x(i)} y={y(v)-15} fontSize="11" textAnchor="middle" fill="#e8e8e8">{v>0?'+':''}{v.toFixed(2)}</text><text x={x(i)} y="235" fontSize="11" fill="#969696" textAnchor="middle">08/{String(i+4).padStart(2,'0')}</text></>}</g>)}
  </svg>
}

/** A schematic density visualization for the product showcase; not measured animal data. */
export function HeatmapPreview() {
  return <svg viewBox="0 0 500 300" role="img" aria-label="Illustrative water maze dwell heatmap, not measured experimental data" className="heatmap-preview">
    <defs>
      <clipPath id="heat-pool-clip"><ellipse cx="248" cy="149" rx="183" ry="129"/></clipPath>
      <radialGradient id="heat-hotspot"><stop offset="0" stopColor="#fa5f29" stopOpacity=".94"/><stop offset=".28" stopColor="#efaa63" stopOpacity=".72"/><stop offset=".65" stopColor="#96b09e" stopOpacity=".36"/><stop offset="1" stopColor="#789e98" stopOpacity="0"/></radialGradient>
      <radialGradient id="heat-coolspot"><stop offset="0" stopColor="#8ccfbe" stopOpacity=".39"/><stop offset="1" stopColor="#8ccfbe" stopOpacity="0"/></radialGradient>
    </defs>
    <rect x="0" y="0" width="500" height="300" rx="11" fill="#11191b"/>
    <g stroke="#344043" strokeWidth=".7" opacity=".55">{Array.from({length:11},(_,i)=><path key={i} d={`M${i*50} 0V300 M0 ${i*30} H500`}/>)}</g>
    <ellipse cx="248" cy="149" rx="183" ry="129" fill="#233138" stroke="#697378" strokeWidth="1.6"/>
    <g clipPath="url(#heat-pool-clip)">
      <ellipse cx="198" cy="153" rx="142" ry="105" fill="url(#heat-coolspot)"/>
      <ellipse cx="298" cy="128" rx="107" ry="88" fill="url(#heat-hotspot)"/>
      <ellipse cx="349" cy="184" rx="92" ry="68" fill="url(#heat-hotspot)" opacity=".65"/>
      <ellipse cx="145" cy="100" rx="93" ry="64" fill="url(#heat-coolspot)"/>
    </g>
    <ellipse cx="248" cy="149" rx="183" ry="129" fill="none" stroke="#879396" strokeWidth="1.3"/>
    <path d="M248 20V278M65 149H431" stroke="#b0b5b5" strokeDasharray="3 8" strokeOpacity=".27"/>
    <circle cx="348" cy="193" r="17" stroke="#f6bd88" strokeWidth="1.6" strokeDasharray="4 5" fill="none"/>
    <g fontSize="12" fill="#acb7b8" fontFamily="monospace"><text x="16" y="24">DWELL DENSITY</text><text x="380" y="283">SPATIAL MAP</text></g>
    <g transform="translate(22 254)"><rect width="88" height="5" rx="2.5" fill="#789e98"/><rect x="34" width="30" height="5" fill="#efaa63"/><rect x="64" width="24" height="5" rx="2.5" fill="#fa5f29"/><text x="0" y="19" fontSize="9" fill="#a3b0ad">LOW</text><text x="70" y="19" fontSize="9" fill="#a3b0ad">HIGH</text></g>
  </svg>
}

export function AnnotationReadout() {
  return <div className="mono annotation-readout">
    <div className="readout-line"><span>ARENA ROI</span><span className="code-green">● SET</span></div>
    <div><em>center</em><span>(1280, 720)</span></div><div><em>radius_x</em><span>846 px</span></div><div><em>radius_y</em><span>624 px</span></div>
    <div className="readout-separator"/>
    <div className="readout-line"><span>LANDMARKS</span><span className="code-green">4 / 4</span></div>
    <div><em>pentacle</em><span>(282, 64)</span></div><div><em>rectangle</em><span>(2275, 710)</span></div><div><em>triangle</em><span>(1320, 1371)</span></div><div><em>round</em><span>(251, 710)</span></div>
    <div className="readout-separator"/>
    <div className="readout-line"><span>PLATFORM</span><span className="code-orange">REVIEW</span></div>
    <div><em>center</em><span>(2075, 960)</span></div>
  </div>
}

export function ResearchLog({ detailed=false }: {detailed?:boolean}) {
  const entries = [
    ['✓','Video imported', '2560 × 1440'],
    ['✓','Frame rate loaded', '30 FPS'],
    ['✓','Pool boundary defined', 'ROI'],
    ['✓','Four reference markers', '4 / 4'],
    ['○','Review platform position', 'REVIEW'],
    ['○','Generate annotation JSON', 'PENDING'],
  ]
  return <div className="research-log">
    <div className="log-heading"><span className="status-dot"/> LingSight / Scene calibration <span className="muted mono">LOCAL</span></div>
    {entries.slice(0,detailed?6:5).map(([symbol,message,time],i)=><div className="log-entry" key={message}><span className={'mono '+(i<4?'log-done':'log-pending')}>{symbol}</span><span>{message}</span><small className="mono">{time}</small></div>)}
  </div>
}
