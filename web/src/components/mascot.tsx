import type { MascotAppearance } from '@/lib/cosmetics'
import './mascot.css'

export function Mascot({ appearance, portrait = false, animate = false, pose = 'ready', className = '', label = 'มาสคอตนักแบด' }: { appearance?: MascotAppearance; portrait?: boolean; animate?: boolean; pose?: 'ready' | 'clap'; className?: string; label?: string }) {
  const skin = { warm: '#d9a071', light: '#f2c7a7', deep: '#945e43' }[appearance?.skin ?? 'warm']
  const hair = appearance?.hair ?? 'short'
  const gear = appearance?.equipment ?? {}
  const outfit = gear.outfit?.color ?? '#eae8df'
  const skirt = gear.outfit?.id.startsWith('outfit-skirt-')
  const dress = gear.outfit?.id.startsWith('outfit-dress-')
  const bow = gear.head?.id.startsWith('head-bow-')
  const outline = '#293b34'
  return <svg role="img" aria-label={label} viewBox={portrait ? '19 6 162 162' : '0 0 200 260'} className={`court-mascot${animate ? ' court-mascot--animated' : ''} ${className}`} xmlns="http://www.w3.org/2000/svg">
    <rect className="court-mascot__backdrop" width="200" height="260" rx="28" fill={gear.background?.color ?? '#e7efdf'} />
    <path className="court-mascot__backdrop" d="M15 216H185M35 150V260M165 150V260" stroke="white" strokeWidth="2" opacity=".55" />
    <ellipse cx="100" cy="238" rx="58" ry="9" fill={outline} opacity=".12" />
    <g className="court-mascot__body" stroke={outline} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M77 194V224Q80 233 89 225L93 191M108 191L111 225Q120 233 123 223V191" fill={skin} />
      <path d="M77 223L68 232Q66 240 90 237L92 225M111 225L110 236Q134 241 134 233L122 223" fill={gear.shoes?.color ?? '#f9f8f2'} />
      {!skirt && !dress && <path d="M70 166L73 197H94L100 177L106 197H127L130 166" fill="#47534d" />}
      {pose !== 'clap' && <path d="M65 126L48 170Q46 180 55 182Q62 181 66 173L82 141M135 126L151 167Q160 175 151 182Q143 183 139 174L118 142" fill={skin} />}
      {dress ? <>
        <path d="M80 115L70 120L79 151L77 163L61 197Q100 210 139 197L123 163L121 151L130 120L120 115Z" fill={outfit} />
        <path d="M82 121L90 151L86 192M118 121L110 151L114 192M80 160H120" fill="none" stroke="#fffaf0" strokeWidth="3" opacity=".8" />
        <path d="M66 195Q100 205 134 195" fill="none" stroke="#fffaf0" strokeWidth="3" />
      </> : <path d="M77 115L59 129L69 146L76 140L71 169Q100 181 129 169L124 141L132 148L141 130L123 115" fill={skirt ? '#f8f5ed' : outfit} />}
      {skirt && <>
        <path d="M75 164H125L140 194Q100 207 60 194Z" fill={outfit} />
        <path d="M84 170L77 194M100 170V198M116 170L123 194" fill="none" strokeWidth="2" opacity=".45" />
        <path d="M76 165H124" fill="none" stroke="#fffaf0" strokeWidth="4" />
        <path d="M81 135H119" fill="none" stroke={outfit} strokeWidth="6" />
      </>}
      <path d="M86 113Q100 131 114 113" fill={skin} />
      {gear.outfit && !skirt && !dress && <path d="M83 139L95 151L117 131" fill="none" stroke="#fff" opacity=".8" />}
      {pose === 'clap' && <g fill={skin}><path className="court-mascot__clap-left" d="M64 142L68 166Q72 170 79 165L99 150Q104 145 99 141Q95 138 91 143L76 153L72 139" /><path className="court-mascot__clap-right" d="M136 142L132 166Q128 170 121 165L101 150Q96 145 101 141Q105 138 109 143L124 153L128 139" /></g>}
      <circle cx="57" cy="78" r="10" fill={skin} /><circle cx="143" cy="78" r="10" fill={skin} />
      {hair === 'bob' && <path d="M52 56Q48 22 99 22Q151 22 149 67L153 116L132 124L64 120L48 112Z" fill="#393331" />}
      <path d="M59 60Q59 28 100 28Q141 28 141 64V84Q139 116 100 121Q61 116 59 84Z" fill={skin} />
      <path d={hair === 'spiky' ? 'M57 65L49 41L66 44L63 21L84 31L95 13L107 31L129 21L130 41L148 41L141 67L121 51L109 62L91 48L78 64L68 54Z' : hair === 'bob' ? 'M57 64Q53 26 100 24Q146 24 143 65L128 47L112 57L108 43L97 57L80 52L62 76Z' : 'M58 68Q49 29 86 25Q132 12 145 53L142 70L128 53L110 59L92 48L73 59L65 77Z'} fill="#393331" />
      <g className="court-mascot__eyes"><path d="M80 80V84M120 80V84" strokeWidth="5" /></g>
      <path d="M91 99Q100 107 109 99" fill="none" />
      <path d="M72 96H79M121 96H128" stroke="#bb7564" opacity=".6" strokeWidth="4" />
      {gear.head && (bow ? <g fill={gear.head.color} strokeWidth="2.5"><path d="M122 35Q104 17 104 31L104 49Q108 56 122 43M128 35Q146 17 146 31L146 49Q142 56 128 43" /><path d="M119 43L113 62L124 57L129 64L132 44" /><rect x="119" y="32" width="12" height="14" rx="4" /></g> : <><path d="M57 52Q60 18 100 20Q137 19 141 52Z" fill={gear.head.color} /><path d="M55 52Q100 43 147 53L151 61Q109 52 55 59Z" fill={gear.head.color} /><path d="M101 25V45" opacity=".3" /></>)}
      <g className="court-mascot__racket"><g transform="rotate(20 158 157)"><path d="M158 144V200" stroke={gear.racket?.color ?? '#667a69'} strokeWidth="6" /><ellipse cx="158" cy="124" rx="17" ry="24" fill="#ffffff" fillOpacity=".8" stroke={gear.racket?.color ?? '#667a69'} strokeWidth="5" /><path d="M147 111V137M154 103V145M162 103V145M169 111V137M144 117H173M143 125H174M145 133H171" strokeWidth="1" opacity=".5" /><path d="M158 187V200" stroke={outline} strokeWidth="7" /></g></g>
      {Object.values(gear).some(item => item?.rarity === 'legendary') && <path d="M167 28L171 39L182 43L171 47L167 58L163 47L152 43L163 39Z" fill="#ebcb60" strokeWidth="2" />}
    </g>
  </svg>
}
