import { getGroupStandings } from '@/lib/group-standings'
import { getGroupMascots } from '@/lib/group-mascots'
import { Mascot } from '@/components/mascot'
import { streakMultiplier } from '@/domain/rating'
import { playingDate } from '@/lib/playing-date'

export async function GroupRankings({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [standings, mascots] = await Promise.all([getGroupStandings(groupId, playingDate()), getGroupMascots(groupId)])
  const rankedPlayers = standings.players.filter(player => !player.archived_at)
  return (
      <section className="rounded-3xl border border-foreground/10 bg-surface p-5 sm:p-7">
        <h2 className="text-xl font-semibold">อันดับในห้องนี้</h2>
        <p className="mt-2 text-sm text-muted">{standings.season?.name ?? 'ยังไม่มีฤดูกาล'} · คะแนนอันดับ Elo เริ่มที่ 1,000 พร้อมโบนัส Win Streak เมื่อชนะติดกัน</p>
        <p className="mt-2 text-xs text-muted">🔥 นับต่อเมื่อรายชื่อคนที่มาเล่นทั้งวันตรงกับครั้งก่อน เปลี่ยนคนจะเริ่ม streak ใหม่ ส่วนคะแนนอันดับยังสะสมต่อ</p>
        {standings.error ? <p role="alert" className="mt-4 text-danger">{standings.error}</p> : !rankedPlayers.length ? <p className="mt-4 text-muted">ยังไม่มีผู้เล่นในห้อง</p> : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">คะแนนอันดับเฉพาะห้อง {groupName}</caption>
              <thead><tr className="border-b border-separator text-muted"><th scope="col" className="py-3 pr-4">ผู้เล่น</th><th scope="col" className="px-3 py-3 text-right">Elo</th><th scope="col" className="px-3 py-3 text-right">เล่น</th><th scope="col" className="py-3 pl-3 text-right whitespace-nowrap">ชนะ / แพ้ / เสมอ</th></tr></thead>
              <tbody>{rankedPlayers.map((player, index) => <tr key={player.id} className="border-b border-separator last:border-0">
                <th scope="row" className="py-4 pr-4 font-medium"><span className="flex items-center gap-3"><span className="text-muted">{index + 1}</span><Mascot appearance={mascots[player.id]} portrait className="size-11 shrink-0 rounded-full" label={`มาสคอตของ ${player.name}`} /><span>{player.name}{player.winStreak >= 2 && <span className="mt-1 block whitespace-nowrap text-xs font-semibold text-orange-700">🔥 {player.winStreak} เกมติด · ×{streakMultiplier(player.winStreak)}</span>}</span></span></th>
                <td className="px-3 py-4 text-right font-semibold tabular-nums text-accent">{player.elo.toLocaleString('th-TH', { maximumFractionDigits: 1 })}</td>
                <td className="px-3 py-4 text-right tabular-nums">{player.seasonGames}</td><td className="py-4 pl-3 text-right tabular-nums">{player.wins} / {player.losses} / {player.draws}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
  )
}
