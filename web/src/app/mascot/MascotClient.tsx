'use client'

import { useRef, useState, useTransition } from 'react'
import { Button, toast } from '@heroui/react'
import { Mascot } from '@/components/mascot'
import { categories, categoryNames, mascotAppearance, rarityNames, type Category, type ChestTier, type Cosmetic, type Equipped, type Hair, type Locker, type LockerOperation, type OpenedChest, type Skin } from '@/lib/cosmetics'
import { updateLocker } from './actions'
import './motion.css'

const skins: { id: Skin; label: string; color: string }[] = [{ id: 'light', label: 'ผิวสว่าง', color: '#f2c7a7' }, { id: 'warm', label: 'ผิวกลาง', color: '#d9a071' }, { id: 'deep', label: 'ผิวเข้ม', color: '#945e43' }]
const hairstyles: { id: Hair; label: string }[] = [{ id: 'short', label: 'สั้น' }, { id: 'bob', label: 'บ๊อบ' }, { id: 'spiky', label: 'ตั้ง' }]
const rarityColor = { common: '#526457', rare: '#256482', epic: '#7b437f', legendary: '#846317' }
const chestColor = { bronze: '#b5825b', silver: '#9aaeb0', gold: '#d7b958' }
const tabs = ['แต่งตัว', 'กระเป๋า', 'ร้านค้า'] as const
type Attempt = { operation: LockerOperation; id: string }

function ChestIcon({ tier, opening = false }: { tier: ChestTier; opening?: boolean }) {
  return <svg viewBox="0 0 100 80" aria-hidden="true" className={`h-20 w-24 shrink-0 ${opening ? 'mascot-chest-opening' : ''}`}><g className="mascot-chest-body"><path d="M14 35Q14 12 34 12H66Q86 12 86 35V66Q86 71 81 71H19Q14 71 14 66Z" fill={chestColor[tier]} stroke="#34483c" strokeWidth="3" /><path d="M14 37H86M29 13V70M71 13V70" stroke="#34483c" strokeWidth="3" opacity=".6" /><rect x="43" y="31" width="14" height="18" rx="3" fill="#f8f4df" stroke="#34483c" strokeWidth="2" /><circle cx="50" cy="39" r="2" fill="#34483c" /></g><g className="mascot-chest-sparks" fill="#c59735"><path d="M9 9l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/><path d="M88 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></g></svg>
}

function ItemPreview({ item, locker }: { item: Cosmetic; locker: Locker }) {
  return <Mascot appearance={mascotAppearance({ ...locker, equipped: { [item.category]: item.id } })} className="h-24 w-[74px]" label={item.name} />
}

export default function MascotClient({ initial }: { initial: Locker }) {
  const [locker, setLocker] = useState(initial)
  const [skin, setSkin] = useState(initial.skin)
  const [hair, setHair] = useState(initial.hair)
  const [equipped, setEquipped] = useState<Equipped>(initial.equipped)
  const [tab, setTab] = useState<(typeof tabs)[number]>('แต่งตัว')
  const [category, setCategory] = useState<Category>('head')
  const [error, setError] = useState('')
  const [opened, setOpened] = useState<OpenedChest | null>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [pending, startTransition] = useTransition()
  const [motion, setMotion] = useState(true)
  const running = useRef(false)
  const locked = pending || attempt !== null
  const ownedItems = locker.catalog.filter(item => locker.owned.includes(item.id))
  const dirty = skin !== locker.skin || hair !== locker.hair || categories.some(key => equipped[key] !== locker.equipped[key])

  function run(operation: LockerOperation, retry?: Attempt) {
    if (running.current || (attempt && !retry)) return
    const next = retry ?? { operation, id: crypto.randomUUID() }
    running.current = true
    setAttempt(next)
    setError('')
    setOpened(null)
    startTransition(async () => {
      try {
        // Give the opening gesture time to read without delaying reduced-motion users.
        const opening = next.operation.kind === 'openChest' && motion
          && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const [result] = await Promise.all([
          updateLocker(next.operation, next.id),
          opening ? new Promise<void>(resolve => setTimeout(resolve, 650)) : Promise.resolve(),
        ])
        if (result.error) {
          setError(result.error)
          if (!result.retry) {
            setAttempt(null)
            toast.danger('ทำรายการไม่สำเร็จ', { description: result.error })
          } else toast.warning('ยังยืนยันรายการไม่ได้', { description: 'กดลองรายการเดิมเพื่อเช็กผลโดยไม่ทำซ้ำ' })
          return
        }
        if (!result.locker) {
          setError('ยังยืนยันผลไม่ได้ กดลองรายการเดิมอีกครั้ง')
          toast.warning('ยังยืนยันรายการไม่ได้', { description: 'กดลองรายการเดิมเพื่อเช็กผลโดยไม่ทำซ้ำ' })
          return
        }
        setLocker(result.locker)
        setAttempt(null)
        if (next.operation.kind === 'save') {
          setSkin(result.locker.skin); setHair(result.locker.hair); setEquipped(result.locker.equipped)
          toast.success('บันทึกตัวละครแล้ว', { description: 'ใช้มาสคอตนี้บนโปรไฟล์และตารางอันดับทุกห้อง' })
        } else if (result.opened) {
          setOpened(result.opened)
          toast.success(`เปิดได้ ${result.opened.item.name}`, { description: result.opened.duplicate ? `มีชิ้นนี้แล้ว ได้คืน ${result.opened.refund} เหรียญ` : 'เพิ่มลงกระเป๋าแล้ว เลือกใส่ได้ที่แต่งตัว' })
        } else if (next.operation.kind === 'buyItem') toast.success('ซื้อของแต่งตัวแล้ว', { description: 'เลือกสวมใส่ได้ที่แต่งตัว' })
        else toast.success('ซื้อกล่องแล้ว', { description: 'เปิดได้ที่กระเป๋า' })
      } catch {
        setError('การเชื่อมต่อขัดข้อง กดลองรายการเดิมเพื่อเช็กผลโดยไม่ทำซ้ำ')
        toast.warning('การเชื่อมต่อขัดข้อง', { description: 'กดลองรายการเดิมเพื่อยืนยันผล' })
      }
      finally { running.current = false }
    })
  }

  function selectItem(id?: string) {
    setEquipped(previous => { const next = { ...previous }; if (id) next[category] = id; else delete next[category]; return next })
  }

  return <>
    <header className="mb-7 mt-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[.16em] text-muted">YOUR COURT, YOUR CHARACTER</p><h1 className="text-3xl font-semibold sm:text-4xl">ตัวฉันข้างสนาม</h1><p className="mt-2 text-sm text-muted">ของสะสมและเหรียญใช้ร่วมทุกห้อง · ของแต่งตัวไม่เพิ่มค่าพลัง</p></div><div className="rounded-full bg-[#e5edcd] px-5 py-3 font-semibold tabular-nums" aria-label={`มี ${locker.coins} เหรียญ`}>{locker.coins.toLocaleString('th-TH')} <span className="text-sm font-normal">เหรียญ</span></div></header>
    <div className="mascot-workshop grid items-start gap-7 md:grid-cols-[260px_1fr]" data-motion={motion ? 'on' : 'off'}>
      <aside className="flex items-center gap-5 rounded-3xl bg-[#e7efdf] p-5 md:sticky md:top-5 md:block md:p-6">
        <Mascot appearance={mascotAppearance({ ...locker, skin, hair, equipped })} animate={motion} className="w-28 shrink-0 md:w-full" />
        <div className="flex-1 md:mt-3"><h2 className="font-semibold">พร้อมลงสนาม</h2><p className="mt-1 text-xs leading-relaxed text-muted">{dirty ? 'กำลังลองชุด อย่าลืมบันทึก' : 'ชุดที่ใช้บนโปรไฟล์ตอนนี้'}</p><Button className="mt-4 w-full" isDisabled={locked || !dirty} isPending={pending && attempt?.operation.kind === 'save'} onPress={() => run({ kind: 'save', skin, hair, equipped })}>บันทึกตัวละคร</Button><Button size="sm" variant="ghost" className="mt-2 w-full" aria-pressed={motion} onPress={() => setMotion(value => !value)}>{motion ? 'หยุดการขยับ' : 'เปิดการขยับ'}</Button></div>
      </aside>
      <div className="min-w-0">
        <nav aria-label="ตู้ของสะสม" className="mb-6 flex gap-2 border-b border-[#dce4d7] pb-4">{tabs.map(value => <Button key={value} size="sm" variant={tab === value ? 'primary' : 'ghost'} aria-pressed={tab === value} onPress={() => setTab(value)}>{value}</Button>)}</nav>
        {error && <div role="alert" className="mb-5 rounded-xl border border-[#dbb7a6] bg-[#fff5ee] p-4"><p className="text-sm">{error}</p>{attempt && <Button className="mt-3" size="sm" isPending={pending} onPress={() => run(attempt.operation, attempt)}>ลองรายการเดิมอีกครั้ง</Button>}</div>}
        {opened && <section aria-live="polite" aria-atomic="true" className="mascot-loot-reveal mb-6 flex gap-4 rounded-2xl border-2 border-[#809c69] bg-white p-5"><ItemPreview item={opened.item} locker={locker} /><div><p className="text-xs text-muted">เปิดกล่องแล้ว · {rarityNames[opened.item.rarity]}</p><h2 className="mt-1 text-lg font-semibold">{opened.item.name}</h2><p className="mt-2 text-sm">{opened.duplicate ? `มีชิ้นนี้แล้ว ได้คืน ${opened.refund} เหรียญ` : 'เพิ่มลงกระเป๋าแล้ว เลือกใส่ได้ที่แต่งตัว'}</p></div></section>}

        {tab === 'แต่งตัว' && <>
          <fieldset disabled={locked} className="mb-7"><legend className="mb-3 font-semibold">เริ่มจากตัวตนของเรา <span className="ml-2 text-xs font-normal text-muted">ปรับได้ฟรี</span></legend><div className="flex flex-wrap gap-x-8 gap-y-5"><div><p className="mb-2 text-xs text-muted">สีผิว</p><div className="flex gap-2">{skins.map(value => <button key={value.id} type="button" aria-label={value.label} aria-pressed={skin === value.id} onClick={() => setSkin(value.id)} className={`grid size-11 place-items-center rounded-full border-2 disabled:opacity-50 ${skin === value.id ? 'border-[#245943]' : 'border-transparent'}`}><span style={{ background: value.color }} className="size-8 rounded-full border border-black/15" /></button>)}</div></div><div><p className="mb-2 text-xs text-muted">ทรงผม</p><div className="flex gap-2">{hairstyles.map(value => <Button key={value.id} size="sm" isDisabled={locked} variant={hair === value.id ? 'secondary' : 'outline'} aria-pressed={hair === value.id} onPress={() => setHair(value.id)}>{value.label}</Button>)}</div></div></div></fieldset>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="ประเภทของแต่งตัว">{categories.map(value => <Button key={value} size="sm" variant={category === value ? 'secondary' : 'ghost'} aria-pressed={category === value} onPress={() => setCategory(value)}>{categoryNames[value]}</Button>)}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><button type="button" disabled={locked} aria-pressed={!equipped[category]} onClick={() => selectItem()} className={`min-h-36 rounded-2xl border-2 bg-white p-4 text-left disabled:opacity-50 ${!equipped[category] ? 'border-[#245943]' : 'border-[#e0e5da]'}`}><p className="text-xl">เรียบง่าย</p><p className="mt-2 text-xs text-muted">{categoryNames[category]}เริ่มต้น</p></button>{ownedItems.filter(item => item.category === category).map(item => <button key={item.id} type="button" disabled={locked} aria-pressed={equipped[category] === item.id} onClick={() => selectItem(item.id)} className={`rounded-2xl border-2 bg-white p-3 text-left disabled:opacity-50 ${equipped[category] === item.id ? 'border-[#245943]' : 'border-[#e0e5da]'}`}><ItemPreview item={item} locker={locker} /><p className="mt-2 text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs" style={{ color: rarityColor[item.rarity] }}>{rarityNames[item.rarity]}</p></button>)}</div>
          {!ownedItems.some(item => item.category === category) && <p className="mt-4 text-sm leading-relaxed text-muted">ยังไม่มี{categoryNames[category]}เพิ่ม รับกล่องจากการจบแมตช์ หรือเลือกซื้อในร้านค้าได้เลย</p>}
        </>}

        {tab === 'กระเป๋า' && <>
          <h2 className="mb-1 text-xl font-semibold">กล่องที่รอเปิด</h2><p className="mb-5 text-sm text-muted">จบแมตช์ได้รับกล่อง หรือซื้อเพิ่มด้วยเหรียญ</p>
          <div className="space-y-3">{locker.chestCatalog.map(chest => <article key={chest.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#dfe6d9] bg-white p-4"><ChestIcon tier={chest.id} opening={pending && attempt?.operation.kind === 'openChest' && attempt.operation.target === chest.id} /><div className="min-w-28 flex-1"><h3 className="font-semibold">{chest.name}</h3><p className="text-sm text-muted">มี {locker.boxes[chest.id]} กล่อง</p></div><Button size="sm" isDisabled={locked || locker.boxes[chest.id] < 1} onPress={() => run({ kind: 'openChest', target: chest.id })}>{pending && attempt?.operation.kind === 'openChest' && attempt.operation.target === chest.id ? 'กำลังเปิด…' : `เปิด ${chest.name}`}</Button><p className="w-full text-xs leading-relaxed text-muted">{Object.entries(chest.odds).map(([rarity, odds]) => `${rarityNames[rarity as keyof typeof rarityNames]} ${odds}%`).join(' · ')}</p></article>)}</div>
          <h2 className="mb-3 mt-8 font-semibold">ของสะสม {ownedItems.length} ชิ้น</h2>{ownedItems.length === 0 ? <p className="text-sm text-muted">กระเป๋ายังว่าง ชุดเริ่มต้นใส่ได้ทันทีที่แต่งตัว</p> : <ul className="divide-y divide-[#e3e9de]">{ownedItems.map(item => <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{item.name} <span className="ml-1 text-xs text-muted">{categoryNames[item.category]}</span></span><span className="text-xs" style={{ color: rarityColor[item.rarity] }}>{rarityNames[item.rarity]}</span></li>)}</ul>}
        </>}

        {tab === 'ร้านค้า' && <>
          <h2 className="text-xl font-semibold">เลือกชุดที่เป็นเรา</h2><p className="mb-5 mt-1 text-sm text-muted">เสื้อกีฬา กระโปรง เดรส และโบว์ เลือกใส่ได้ทุกตัวละคร · ซื้อด้วยเหรียญจากการเล่น</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{locker.catalog.map(item => { const owned = locker.owned.includes(item.id); return <article key={item.id} className="flex flex-col rounded-2xl border border-[#dfe6d9] bg-white p-3"><ItemPreview item={item} locker={locker} /><p className="mb-1 mt-3 text-xs" style={{ color: rarityColor[item.rarity] }}>{categoryNames[item.category]} · {rarityNames[item.rarity]}</p><h3 className="mb-4 flex-1 text-sm font-semibold">{item.name}</h3><Button size="sm" variant="outline" isDisabled={locked || owned || locker.coins < item.price} aria-label={owned ? `มี ${item.name} แล้ว` : `ซื้อ ${item.name} ${item.price} เหรียญ`} onPress={() => run({ kind: 'buyItem', target: item.id })}>{owned ? 'มีแล้ว' : `${item.price} เหรียญ`}</Button></article> })}</div>
          <h2 className="mb-4 mt-9 text-xl font-semibold">กล่องสุ่ม</h2><div className="space-y-4">{locker.chestCatalog.map(chest => <article key={chest.id} className="rounded-2xl border border-[#dfe6d9] bg-white p-4"><div className="flex flex-wrap items-center gap-3"><ChestIcon tier={chest.id} /><h3 className="flex-1 font-semibold">{chest.name}</h3><Button size="sm" isDisabled={locked || locker.coins < chest.price} aria-label={`ซื้อ ${chest.name} ${chest.price} เหรียญ`} onPress={() => run({ kind: 'buyChest', target: chest.id })}>{chest.price} เหรียญ</Button></div><p className="mt-2 text-xs leading-relaxed text-muted">โอกาสได้รับ: {Object.entries(chest.odds).map(([rarity, odds]) => `${rarityNames[rarity as keyof typeof rarityNames]} ${odds}%`).join(' · ')}</p></article>)}</div><p className="mt-4 text-xs text-muted">แต่ละกล่องได้ของ 1 ชิ้น ถ้าได้ชิ้นซ้ำจะเปลี่ยนเป็นเหรียญแทน</p>
        </>}
      </div>
    </div>
  </>
}
