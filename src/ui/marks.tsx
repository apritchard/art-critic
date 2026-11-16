import { characterName } from '../engine/stats'
import { useStore } from '../state/store'

/** " 📌 ★": a character's Building and ★ Priority marks, to follow their name. */
export const marks = (ref: { priority: string; building?: boolean }) =>
  `${ref.building ? ' 📌' : ''}${ref.priority === 'priority' ? ' ★' : ''}`

/** Puts a character on the Building list or takes them off. */
export function BuildingToggle({ char, label }: { char: string; label?: boolean }) {
  const { building, toggleBuilding } = useStore()
  const on = building.includes(char)
  return (
    <button
      className={`pin${on ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        toggleBuilding(char)
      }}
      aria-pressed={on}
      title={
        on
          ? `Take ${characterName(char)} off the Building list`
          : `Building ${characterName(char)} now: keep them at the top of lists, first pick of free upgrades, and rank farming for them`
      }
    >
      📌{label && (on ? ' Building' : ' Build now')}
    </button>
  )
}
