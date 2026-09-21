'use client'

import { Fragment, useState } from 'react'
import { Button, Input, toast } from '@heroui/react'
import { CourtScene } from '@/components/court-scene'
import { Mascot } from '@/components/mascot'
import { GenderIcon, GenderSelector } from '@/components/gender-selector'
import type { PlayerGender, RotationMode } from '@/domain/types'
import { MatchRatingSummary } from '@/components/match-rating-summary'
import { blendedRating, ELO_BASE, streakMultiplier } from '@/domain/rating'
import { genderCompositionDifference } from '@/domain/pairing'
import { playerTotals, scoreError, matchRatings, demoResult, demoHeadToHead, demoPairingPlayers, demoRetainedPairs, planDemoCourts, type DemoCourt, type DemoMatch } from './scoring'

const today = '2026-09-16'
const players = [
  { id: 'a', name: 'ต้น', skill: 3, level: 'กลาง' },
  { id: 'b', name: 'มิน', skill: 3, level: 'กลาง' },
  { id: 'c', name: 'เจ', skill: 4, level: 'คล่อง' },
  { id: 'd', name: 'พลอย', skill: 2, level: 'เริ่มต้น' },
  { id: 'e', name: 'บอส', skill: 4, level: 'คล่อง' },
  { id: 'f', name: 'ฝน', skill: 3, level: 'กลาง' },
  { id: 'g', name: 'นัท', skill: 3, level: 'กลาง' },
  { id: 'h', name: 'แป้ง', skill: 2, level: 'เริ่มต้น' },
  { id: 'i', name: 'โอ๊ต', skill: 3, level: 'กลาง' },
  { id: 'j', name: 'เมย์', skill: 3, level: 'กลาง' },
  { id: 'k', name: 'คิม', skill: 4, level: 'คล่อง' },
  { id: 'l', name: 'น้ำ', skill: 2, level: 'เริ่มต้น' },
]
// Authored demo values, independent of names; the real roster uses each player's input.
const sampleGenders: Record<string, PlayerGender> = { a: 'male', b: 'female', c: 'male', d: 'female', e: 'male', f: 'female', g: 'male', h: 'female', i: 'unspecified', j: 'unspecified', k: 'male', l: 'female' }
const sampleRoster = players.map(player => player.id)
const sampleMatches: DemoMatch[] = [
  { id: 1, date: '2026-09-09', target: 11, a: ['a', 'b'], b: ['c', 'd'], scoreA: 11, scoreB: 7, streakRoster: sampleRoster },
  { id: 2, date: '2026-09-09', target: 21, a: ['e', 'f'], b: ['g', 'h'], scoreA: 18, scoreB: 21, streakRoster: sampleRoster },
  { id: 3, date: today, target: 21, a: ['a', 'd'], b: ['b', 'c'], scoreA: 21, scoreB: 18, streakRoster: sampleRoster },
  { id: 4, date: today, target: 21, a: ['e', 'h'], b: ['f', 'g'], scoreA: 19, scoreB: 21, streakRoster: sampleRoster },
  { id: 5, date: today, target: 11, a: ['a', 'g'], b: ['c', 'e'], scoreA: 11, scoreB: 8, streakRoster: sampleRoster },
  { id: 6, date: today, target: 11, a: ['b', 'f'], b: ['d', 'h'], scoreA: 9, scoreB: 11, streakRoster: sampleRoster },
]
type PreviewCourt = DemoCourt & { preset: string; custom: string; scoreA: string; scoreB: string; error: string }
const initialCourts: PreviewCourt[] = [
  { no: 1, active: { target: 21, rotationMode: 'all_out', a: ['a', 'b'], b: ['c', 'd'] }, rotationMode: 'all_out' },
  { no: 2, active: { target: 11, rotationMode: 'winner_stays', a: ['e', 'f'], b: ['g', 'h'] }, rotationMode: 'winner_stays' },
].map(court => ({ ...court, previous: null, allowRetention: true, preset: String(court.active.target), custom: '15', scoreA: '', scoreB: '', error: '' })) as PreviewCourt[]
const tabs = ['สัปดาห์นี้', 'สนาม', 'ประวัติ', 'สถิติ'] as const
const name = (id: string) => players.find(player => player.id === id)!.name
const names = (ids: string[]) => ids.map(name).join(' + ')
const sceneTeam = (ids: readonly string[]) => ids.map(id => ({ id, name: name(id) }))
const playerNames = Object.fromEntries(players.map(player => [player.id, player.name]))
const panel = 'rounded-3xl border border-[#e1e6df] bg-white p-5 sm:p-6'

function Avatar({ id }: { id: string }) {
  const player = players.find(item => item.id === id)!
  return <Mascot portrait className="size-10 shrink-0 rounded-full" label={`มาสคอตของ ${player.name}`} />
}

function HeadToHead({ matches, teams, className = '' }: { matches: DemoMatch[]; teams: Pick<DemoMatch, 'a' | 'b'>; className?: string }) {
  const totals = demoHeadToHead(matches, teams.a, teams.b)
  return <div className={`grid gap-3 text-xs leading-relaxed sm:grid-cols-[0.8fr_1fr_1fr] ${className}`}>
    <div><p>พบกัน {totals.games} เกม</p><p>เสมอ {totals.draws}</p></div>
    <div><p className="font-semibold">{names(teams.a)}</p><p>ชนะ {totals.aWins} / แพ้ {totals.bWins}</p></div>
    <div><p className="font-semibold">{names(teams.b)}</p><p>ชนะ {totals.bWins} / แพ้ {totals.aWins}</p></div>
  </div>
}

export default function PreviewClient() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('สัปดาห์นี้')
  const [attending, setAttending] = useState(sampleRoster)
  const [genders, setGenders] = useState(sampleGenders)
  const [matches, setMatches] = useState(sampleMatches)
  const [courts, setCourts] = useState(initialCourts)
  const [notice, setNotice] = useState('')
  const [period, setPeriod] = useState('week')
  const [historyDate, setHistoryDate] = useState('all')
  const latestResult = matches.length > sampleMatches.length ? matches[matches.length - 1] : null
  const { ratings, changes: ratingSummary, winStreaks } = matchRatings(matches, attending)
  const rankedPlayers = [...players].sort((a, b) => (ratings[b.id] ?? ELO_BASE) - (ratings[a.id] ?? ELO_BASE))
  const currentMatches = matches.filter(match => match.date === today)
  const selectedMatches = period === 'week' ? currentMatches : matches
  const playing = courts.flatMap(court => court.active ? [...court.active.a, ...court.active.b] : [])
  const retained = demoRetainedPairs(attending, courts)
  const reservedPlayers = [...retained.values()].flat()
  const waiting = attending.filter(id => !playing.includes(id) && !reservedPlayers.includes(id))
  const pairingOptions = { players: players.map(player => ({ ...player, gender: genders[player.id] })), ratingMatches: matches }
  const plans = planDemoCourts(attending, currentMatches, courts, pairingOptions)
  const pairingPlayers = demoPairingPlayers(attending, currentMatches, pairingOptions)
  const teamRating = (ids: string[]) => Math.round(ids.reduce((sum, id) => {
    const player = pairingPlayers.find(player => player.id === id)!
    return sum + blendedRating(player.elo, player.seasonGames, player.skill)
  }, 0) / ids.length)
  function updateCourt(no: number, patch: Partial<PreviewCourt>) {
    setCourts(previous => previous.map(court => court.no === no ? { ...court, ...patch } : court))
  }

  function finishMatch(no: number, event?: React.FormEvent, result?: 'draw') {
    event?.preventDefault()
    const court = courts.find(court => court.no === no)!
    if (!court.active) return
    const a = court.scoreA.trim() === '' ? result === 'draw' ? 0 : NaN : Number(court.scoreA)
    const b = court.scoreB.trim() === '' ? result === 'draw' ? 0 : NaN : Number(court.scoreB)
    const invalid = scoreError(court.active.target, a, b, result)
    if (invalid) { updateCourt(no, { error: invalid }); toast.danger(invalid); return }
    const finished: DemoMatch = { ...court.active, id: matches.length + 1, courtNo: no, date: today, scoreA: a, scoreB: b, result: result ?? (a > b ? 'A' : 'B'), streakRoster: [...attending] }
    setMatches(previous => [...previous, finished])
    updateCourt(no, { active: null, previous: finished, allowRetention: true, scoreA: '', scoreB: '', error: '' })
    const message = `คอร์ท ${no} · ${result === 'draw' ? 'บันทึกเสมอแล้ว ทั้งสี่คนออกจากสนาม' : `บันทึก ${a}–${b} แล้ว · ${court.active.rotationMode === 'winner_stays' ? 'ทีมชนะอยู่ต่อ' : 'ทั้งสี่คนออกจากสนาม'}`}`
    setNotice(message)
    toast.success(message)
  }

  function startMatch(no: number) {
    const court = courts.find(court => court.no === no)!
    const target = Number(court.preset === 'custom' ? court.custom : court.preset)
    if (!Number.isInteger(target) || target < 1 || target > 99) {
      const message = 'กำหนดแต้มเป้าหมายเป็นจำนวนเต็ม 1–99'
      updateCourt(no, { error: message }); toast.danger(message); return
    }
    const nextTeams = plans[no]
    if (court.active || !nextTeams) return
    updateCourt(no, { active: { target, ...nextTeams, rotationMode: court.rotationMode }, error: '' })
    const message = `คอร์ท ${no} · เริ่มเกมตัวอย่างแล้ว`
    setNotice(message); toast.success(message)
  }

  function reset() {
    setMatches(sampleMatches); setCourts(initialCourts); setAttending(sampleRoster); setGenders(sampleGenders)
    setNotice('เริ่มข้อมูลตัวอย่างใหม่แล้ว'); toast.success('รีเซ็ตตัวอย่างแล้ว')
  }

  function renderCourt(court: PreviewCourt) {
    const { no, active, rotationMode, preset, custom, scoreA, scoreB, error } = court
    const nextTeams = plans[no]
    const awaitingWinner = active?.rotationMode === 'winner_stays'
    const sceneMatch = active ?? court.previous
    const contenders = active ?? nextTeams
    const target = Number(preset === 'custom' ? custom : preset)
    const composition = nextTeams ? genderCompositionDifference(nextTeams.a.map(id => genders[id]), nextTeams.b.map(id => genders[id])) : null

  const courtPanel = <section className="overflow-hidden rounded-3xl bg-[#245943] text-white" aria-labelledby={`court-title-${no}`}>
    <div className="flex items-center justify-between px-6 pt-6">
      <h2 id={`court-title-${no}`} className="text-lg font-semibold">คอร์ท {String(no).padStart(2, '0')}</h2>
      <span className="rounded-full bg-white/10 px-3 py-1 text-xs">{active ? '● กำลังเล่น' : 'พร้อมลงสนาม'}</span>
    </div>
    {sceneMatch && <CourtScene teamA={sceneTeam(sceneMatch.a)} teamB={sceneTeam(sceneMatch.b)} phase={active ? 'playing' : 'result'} winner={!active && court.previous ? demoResult(court.previous) : undefined} resultId={!active && court.previous ? `${no}-${court.previous.id}` : undefined} className="m-4 sm:m-6" />}
    {active ? <>
      <p className="px-6 pb-4 text-sm text-white/80">{active.rotationMode === 'winner_stays' ? 'จบเกม: ทีมชนะอยู่ต่อ · ถ้าเสมอออกทั้งสี่คน' : 'จบเกม: ออกทั้งสี่คน'}</p>
      <form onSubmit={event => finishMatch(no, event)} className="px-6 pb-6">
        <div className="mb-3 flex items-center justify-between text-sm"><span>บันทึกผลเกมนี้</span><span className="text-[#d6ef93]">เป้าหมาย {active.target} แต้ม</span></div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Input aria-label={`คอร์ท ${no} คะแนนทีม A`} type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={scoreA} onChange={event => updateCourt(no, { scoreA: event.target.value, error: '' })} className="h-16 w-full rounded-xl bg-white text-center text-3xl font-semibold text-[#213b30]" />
          <span className="text-white/60">:</span>
          <Input aria-label={`คอร์ท ${no} คะแนนทีม B`} type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={scoreB} onChange={event => updateCourt(no, { scoreB: event.target.value, error: '' })} className="h-16 w-full rounded-xl bg-white text-center text-3xl font-semibold text-[#213b30]" />
        </div>
        <Button type="submit" fullWidth className="mt-4 bg-[#d6ef93] font-semibold text-[#213b30]">บันทึกผลตัวอย่าง <span aria-hidden="true">↗</span></Button>
        <Button type="button" fullWidth variant="outline" className="mt-3 border-white/70 text-white hover:bg-white/10" onPress={() => finishMatch(no, undefined, 'draw')}>หมดเวลา · บันทึกเสมอ</Button>
        <p className="mt-3 text-xs leading-relaxed text-white/75">แต้มเกินเป้าหมายได้ เช่น 22–20 · หมดเวลาเลือกเสมอได้แม้แต้มไม่เท่ากัน</p>
      </form>
    </> : <div className="p-6"><p className="mb-5 text-white/80">เกมจบแล้ว พร้อมสำหรับคู่ต่อไป</p><Button fullWidth onPress={() => startMatch(no)} isDisabled={!nextTeams} className="bg-[#d6ef93] text-[#213b30]">เริ่มเกมใหม่ · {Number.isInteger(target) && target > 0 && target <= 99 ? target : '—'} แต้ม</Button></div>}
    {contenders && <div className="mx-6 mb-6 rounded-xl bg-white/10 p-3"><p className="mb-3 text-sm font-medium">{active ? 'สถิติก่อนเกมนี้' : 'คู่ถัดไป · สถิติก่อนเริ่ม'}</p><HeadToHead matches={matches} teams={contenders} /></div>}
    {error && <p role="alert" className="mx-6 mb-6 rounded-xl bg-[#fff0e6] p-3 text-sm text-[#82300a]">{error}</p>}
  </section>

  const nextCard = <section className={panel} aria-labelledby={`next-pair-title-${no}`}>
    <div className="mb-4 flex items-center justify-between gap-3"><h2 id={`next-pair-title-${no}`} className="font-semibold">เตรียมตัวคู่ต่อไป</h2><span className="text-xs text-muted">{awaitingWinner ? 'รอผลเกมนี้' : active ? 'คู่เตรียมพร้อม' : 'คู่ที่จะลงจริง'}</span></div>
    {retained.has(no) && <p className="mb-4 text-sm text-[#39734b]">{names(retained.get(no)!)} · รออยู่ต่อคอร์ท {no}</p>}
    {nextTeams ? <>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {[nextTeams.a, nextTeams.b].map((team, side) => <Fragment key={side}>
          {side === 1 && <span className="text-xs font-semibold text-muted">VS</span>}
          <div className={`min-w-0 rounded-2xl p-3 ${side === 0 ? 'bg-[#edf2e9]' : 'bg-[#f3f0e8]'}`}>
            <p className="mb-3 text-xs font-semibold">ทีม {side === 0 ? 'A' : 'B'}</p>
            {team.map(id => <div key={id} className="mb-2 flex flex-wrap items-center gap-2"><Avatar id={id} /><span className="text-sm">{name(id)}</span><GenderIcon gender={genders[id]} /></div>)}
            <p className="mt-3 text-xs text-muted">เรตทีม <strong className="text-[#245943]">{teamRating(team)}</strong></p>
          </div>
        </Fragment>)}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">เรียงคนรอก่อน · ถ่วงเรต Elo กับระดับฝีมือ · {composition === 0 ? 'สัดส่วนชาย–หญิงสองทีมเท่ากัน' : composition === null ? 'มีผู้เล่นไม่ระบุเพศ จัดตามเรตและคิว' : 'เลือกคู่ที่เหมาะที่สุดภายใต้ลำดับคิว'}</p>
      <HeadToHead matches={matches} teams={nextTeams} className="mt-3 border-t border-[#e1e6df] pt-3 text-muted" />
    </> : <p className="text-sm leading-relaxed text-muted">{awaitingWinner ? 'รอทีมชนะจากเกมนี้ แล้วจัดสองคนเข้าท้าชิง · ถ้าเสมอจัดคู่ใหม่ทั้งสี่คน' : active ? 'รอคนว่างจากคิวร่วม · ผู้เล่นที่จัดให้คอร์ทอื่นแล้วจะไม่ซ้ำกัน' : 'รอคนว่างให้ครบ 4 คน หรือเช็กชื่อเพิ่ม'}</p>}
  </section>

  const settings = <section className={panel} aria-labelledby={`rules-title-${no}`}>
    <h2 id={`rules-title-${no}`} className="font-semibold">เล่นกี่แต้มดี?</h2>
    <p className="mb-4 mt-1 text-sm text-muted">ตั้งค่าเกมถัดไป · เกมที่เริ่มแล้วใช้ค่าเดิม</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={`แต้มเป้าหมายคอร์ท ${no}`}>
      {[['11', '11 แต้ม'], ['21', '21 แต้ม'], ['custom', 'กำหนดเอง']].map(([value, label]) => <Button key={value} size="sm" variant={preset === value ? 'primary' : 'outline'} aria-pressed={preset === value} onPress={() => { updateCourt(no, { preset: value, error: '' }); toast.info(`คอร์ท ${no} · ตั้งค่าแต้มเกมถัดไปแล้ว`) }}>{label}</Button>)}
    </div>
    <label className="my-4 block text-sm">การเปลี่ยนคนหลังจบเกม<select value={rotationMode} disabled={Boolean(active)} onChange={event => { updateCourt(no, { rotationMode: event.target.value as RotationMode, allowRetention: false }); toast.info(`คอร์ท ${no} · เปลี่ยนโหมดเกมถัดไปแล้ว`) }} className="mt-2 block min-h-11 w-full rounded-xl border border-[#d9e1d7] bg-white px-3 disabled:opacity-60"><option value="all_out">ออกทั้งสี่คน</option><option value="winner_stays">ผู้ชนะอยู่ต่อ</option></select></label>
    {active && <p className="mb-3 text-xs text-muted">เปลี่ยนโหมดได้ก่อนเริ่มเกมถัดไป</p>}
    {preset === 'custom' && <label className="mt-4 block text-sm">แต้มเป้าหมาย (1–99)<Input className="mt-2 w-full" aria-label={`แต้มเป้าหมายกำหนดเองคอร์ท ${no}`} type="number" min="1" max="99" step="1" value={custom} onChange={event => updateCourt(no, { custom: event.target.value })} /></label>}
  </section>

    return <div key={no} className="space-y-4">{courtPanel}{nextCard}<details className="rounded-3xl border border-[#e1e6df] bg-white"><summary className="cursor-pointer px-6 py-4 text-sm font-semibold">ตั้งค่าเกมถัดไป · คอร์ท {no}</summary>{settings}</details></div>
  }

  return <div className="pb-10">
    <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e6df] pb-4 text-xs text-muted">
      <p><span className="mr-2 rounded bg-[#e9eddc] px-2 py-1 font-semibold text-[#52622f]">DEMO</span>ข้อมูลตัวอย่าง · ลองกดได้ · รีเฟรชแล้วเริ่มใหม่</p>
      <Button size="sm" variant="ghost" onPress={reset}>รีเซ็ตตัวอย่าง</Button>
    </div>

    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><h1 className="font-[family-name:var(--font-mitr)] text-3xl leading-tight tracking-tight sm:text-4xl">ก๊วนวันพุธ<span className="text-[#639240]">.</span></h1><p className="mt-3 text-sm text-muted">เลิกงานแล้ว เจอกันที่คอร์ท</p></div>
      <Button onPress={() => setTab(tab === 'สนาม' ? 'สัปดาห์นี้' : 'สนาม')} variant="primary" className="px-5">{tab === 'สนาม' ? 'ดูรายชื่อ' : 'ไปที่สนาม'} <span aria-hidden="true">↗</span></Button>
    </header>

    <nav aria-label="หน้าก๊วน" className="my-7 flex gap-1 overflow-x-auto border-b border-[#e1e6df] pb-2">
      {tabs.map(item => <Button key={item} variant={tab === item ? 'secondary' : 'ghost'} aria-current={tab === item ? 'page' : undefined} className="shrink-0 px-4 sm:px-6" onPress={() => setTab(item)}>{item}{item === 'สัปดาห์นี้' && <span className="text-xs opacity-60">{attending.length}</span>}</Button>)}
    </nav>
    {notice && <p role="status" className="mb-5 rounded-xl bg-[#e6efde] px-4 py-3 text-sm text-[#245943]">{notice}</p>}
    {latestResult && <div className="mb-6"><MatchRatingSummary
      changes={ratingSummary}
      names={playerNames}
      title={`ผลแมตช์ล่าสุด · ${demoResult(latestResult) === 'draw' ? 'เสมอ · ' : ''}${latestResult.scoreA}–${latestResult.scoreB}`}
      description="คะแนนสะสม Elo ของผู้เล่นทั้ง 4 คน หลังจบเกมตัวอย่าง"
    /></div>}

    {tab === 'สัปดาห์นี้' && <>
      <section className="mb-7 flex flex-wrap items-center gap-5 rounded-3xl bg-[#edf0e5] p-5 sm:gap-7 sm:p-6">
        <div className="grid size-20 shrink-0 place-content-center rounded-2xl bg-[#d6ef93] text-center text-[#245943]"><span className="text-[11px] font-semibold">กันยายน</span><strong className="text-4xl leading-tight">16</strong></div>
        <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-semibold text-muted">นัดประจำสัปดาห์</p><h2 className="text-lg font-semibold sm:text-xl">พุธนี้ ตีแบดกัน</h2><p className="mt-2 text-sm text-muted">18:00–21:00 น. <span className="mx-1">·</span> สนามตัวอย่าง 2 คอร์ท</p></div>
        <div className="flex w-full justify-around gap-6 border-t border-[#d8dfce] pt-4 sm:w-auto sm:justify-start sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
          {[[attending.length, 'คนพร้อมตี'], [waiting.length, 'คนรอเล่น'], [currentMatches.length, 'เกมที่จบ']].map(([value, label]) => <div key={label} className="text-center"><strong className="text-3xl font-semibold tabular-nums">{value}</strong><p className="mt-1 text-xs text-muted">{label}</p></div>)}
        </div>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section className={panel} aria-labelledby="roster-title">
          <div className="mb-5 flex items-center justify-between"><div><h2 id="roster-title" className="text-lg font-semibold">ใครมาบ้าง</h2><p className="mt-1 text-sm text-muted">เช็กชื่อเพื่อนที่พร้อมลงสนาม</p></div><span className="rounded-full bg-[#edf2e9] px-3 py-1 text-sm font-semibold">{attending.length}/{players.length}</span></div>
          <div className="flex justify-between border-b border-[#edf0eb] pb-3 text-xs text-muted"><span>ผู้เล่น / ระดับฝีมือ</span><span>วันนี้ · เช็กชื่อ</span></div>
          {players.map(player => {
            const present = attending.includes(player.id)
            const inGame = playing.includes(player.id)
            const retainedCourt = [...retained].find(([, ids]) => ids.includes(player.id))?.[0]
            return <div key={player.id} className="border-b border-[#edf0eb] py-3 last:border-0"><div className="flex items-center gap-3">
              <Avatar id={player.id} /><div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-1 font-semibold">{player.name}<GenderIcon gender={genders[player.id]} />{inGame && <span className="ml-2 text-xs font-normal text-[#39734b]">อยู่ในสนาม</span>}{retainedCourt && <span className="text-xs font-normal text-[#39734b]">รออยู่ต่อคอร์ท {retainedCourt}</span>}</p><p className="text-xs text-muted">{player.level}</p></div>
              <span className="mr-2 whitespace-nowrap text-xs text-muted">{playerTotals(player.id, currentMatches).games} เกม</span>
              <Button size="sm" variant={present ? 'secondary' : 'outline'} isDisabled={inGame || retainedCourt !== undefined} aria-label={`${present ? 'ยกเลิกเช็กชื่อ' : 'เช็กชื่อ'} ${player.name}`} aria-pressed={present} className="min-w-20" onPress={() => { setAttending(previous => present ? previous.filter(id => id !== player.id) : [...previous, player.id]); toast.success(`${present ? 'ยกเลิกเช็กชื่อ' : 'เช็กชื่อ'} ${player.name} แล้ว`) }}>{present ? '✓ มาแล้ว' : 'เช็กชื่อ'}</Button>
              </div><details className="ml-13 mt-2 text-xs text-muted"><summary className="cursor-pointer py-1">แก้เพศตัวอย่าง</summary><div className="py-3"><GenderSelector name={`gender-${player.id}`} label={`เพศสำหรับจัดคู่ของ ${player.name}`} value={genders[player.id]} onChange={gender => { setGenders(previous => ({ ...previous, [player.id]: gender })); toast.success(`อัปเดตเพศตัวอย่างของ ${player.name} แล้ว`) }} /></div></details>
            </div>
          })}
        </section>
        <div className="space-y-6">{courts.map(renderCourt)}</div>
      </div>
    </>}

    {tab === 'สนาม' && <><div className="mb-6 grid items-start gap-6 xl:grid-cols-2">{courts.map(renderCourt)}</div><section className={panel}><h2 className="mb-4 font-semibold">คิวรอร่วม <span className="text-muted">{waiting.length} คน</span></h2><p className="mb-4 text-xs text-muted">ผู้เล่นที่ว่างใช้คิวเดียวกันทั้งสองคอร์ท · จัดให้คอร์ทว่างก่อน</p><div className="grid gap-x-6 sm:grid-cols-2">{waiting.map(id => <div key={id} className="flex items-center gap-3 border-t border-[#edf0eb] py-3"><Avatar id={id} /><span className="flex-1">{name(id)} <GenderIcon gender={genders[id]} /></span><span className="text-sm text-muted">เล่นแล้ว {playerTotals(id, currentMatches).games} เกม</span></div>)}</div></section></>}

    {tab === 'ประวัติ' && <section className={panel}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">ทุกเกมที่เล่นด้วยกัน</h2><p className="mt-1 text-sm text-muted">ผลและแต้มเป้าหมายของแต่ละเกม</p></div><label className="text-sm">วันเล่น <select aria-label="เลือกวันดูประวัติ" value={historyDate} onChange={event => setHistoryDate(event.target.value)} className="ml-2 rounded-xl border border-[#d9e1d7] bg-white p-2"><option value="all">ทุกวัน</option><option value={today}>16 ก.ย. 2569</option><option value="2026-09-09">9 ก.ย. 2569</option></select></label></div>
      {[...matches].reverse().filter(match => historyDate === 'all' || match.date === historyDate).map(match => <article key={match.id} className="border-t border-[#e8ede5] py-5"><div className="mb-3 flex justify-between text-xs text-muted"><span>{match.date === today ? '16 ก.ย. 2569' : '9 ก.ย. 2569'} · เกม #{match.id}{match.courtNo && ` · คอร์ท ${match.courtNo}`}</span><span>{demoResult(match) === 'draw' ? 'เสมอเมื่อหมดเวลา' : `เป้าหมาย ${match.target} แต้ม`}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"><p className={`text-sm sm:text-base ${demoResult(match) === 'A' ? 'font-semibold text-[#245943]' : 'text-muted'}`}>{names(match.a)}{demoResult(match) === 'A' && <span className="ml-2 text-xs">ชนะ</span>}</p><strong className="rounded-xl bg-[#edf2e8] px-4 py-2 text-xl tabular-nums">{match.scoreA} : {match.scoreB}</strong><p className={`text-right text-sm sm:text-base ${demoResult(match) === 'B' ? 'font-semibold text-[#245943]' : 'text-muted'}`}>{names(match.b)}{demoResult(match) === 'B' && <span className="ml-2 text-xs">ชนะ</span>}</p></div></article>)}
    </section>}

    {tab === 'สถิติ' && <section className={panel}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">คะแนนสะสมรายคน</h2><p className="mt-1 text-sm text-muted">เรียงตามคะแนน Elo ล่าสุด พร้อมจำนวนเกมและชนะ–แพ้</p></div><div className="flex gap-2" role="group" aria-label="ช่วงเวลาสถิติ"><Button size="sm" variant={period === 'week' ? 'primary' : 'outline'} aria-pressed={period === 'week'} onPress={() => setPeriod('week')}>สัปดาห์นี้</Button><Button size="sm" variant={period === 'all' ? 'primary' : 'outline'} aria-pressed={period === 'all'} onPress={() => setPeriod('all')}>ทั้งหมด</Button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><caption className="sr-only">สถิติรายคน {period === 'week' ? 'สัปดาห์นี้' : 'ทั้งหมด'} และคะแนน Elo สะสมล่าสุด</caption><thead><tr className="border-b border-[#dce4d7] text-left text-xs text-muted">{['ผู้เล่น', 'คะแนน Elo', 'ชนะต่อเนื่อง', 'เกม', 'ชนะ', 'แพ้', 'เสมอ', 'ชนะ %'].map(label => <th scope="col" key={label} className="px-2 py-3 first:pl-0">{label}</th>)}</tr></thead><tbody>{rankedPlayers.map(player => { const total = playerTotals(player.id, selectedMatches); const streak = winStreaks[player.id] ?? 0; return <tr key={player.id} className="border-b border-[#edf0eb] last:border-0"><th scope="row" className="flex items-center gap-3 py-3 pr-4 text-left font-medium"><Avatar id={player.id} />{player.name}</th><td className="px-2 py-3 font-semibold tabular-nums text-[#245943]">{Math.round(ratings[player.id] ?? ELO_BASE).toLocaleString('th-TH')}</td><td className="px-2 py-3"><span className={streak >= 2 ? 'whitespace-nowrap rounded-full bg-[#fff1df] px-2 py-1 text-xs font-semibold text-[#88471a]' : 'text-muted'}>{streak >= 2 ? `🔥 ${streak} เกม · ×${streakMultiplier(streak)}` : `${streak} เกม`}</span></td>{[total.games, total.wins, total.losses, total.draws, total.games ? `${Math.round(total.wins / total.games * 100)}%` : '—'].map((value, index) => <td key={index} className="px-2 py-3 tabular-nums">{value}</td>)}</tr> })}</tbody></table></div>
      <p className="mt-5 text-xs leading-relaxed text-muted">Elo สะสมต่อเนื่องจากทุกเกม เริ่มที่ {ELO_BASE.toLocaleString('th-TH')} และปรับตามผลชนะ–แพ้–เสมอกับเรตคู่แข่ง · ช่วงเวลาที่เลือกใช้กรองจำนวนเกมและชนะ–แพ้เท่านั้น</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">ชนะต่อเนื่อง 2 / 3 / 4 / 5+ เกม รับตัวคูณคะแนนที่เพิ่ม ×1.1 / ×1.2 / ×1.3 / ×1.5 · แพ้หรือเสมอแล้วเริ่มนับใหม่</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">รายชื่อคนมาวันนี้เปลี่ยน จะเริ่มชนะต่อเนื่องใหม่ทุกคน · สลับคู่ในกลุ่มเดิมไม่รีเซ็ต · คะแนน Elo เดิมยังอยู่</p>
    </section>}
    <p className="mt-8 text-center text-xs text-muted">พื้นที่ทดลองหน้าตาและการใช้งาน · ข้อมูลสมมติ ไม่บันทึกลงฐานข้อมูล</p>
  </div>
}
