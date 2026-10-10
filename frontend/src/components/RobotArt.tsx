import { MascotPortrait } from './Branding'

type RobotProps = { className?: string; title?: string }

/** Keep existing illustration call sites while using the named RoboThink mascots. */
export function RobotIdle({ className = 'w-16 h-16', title }: RobotProps) {
  return <MascotPortrait name="Jodie" className={className} title={title ?? 'Jodie, RoboThink mascot'} />
}

export function RobotWave({ className = 'w-16 h-16', title }: RobotProps) {
  return <MascotPortrait name="Tori" className={className} title={title ?? 'Tori, RoboThink mascot'} />
}

export function RobotBadge({ className = 'w-8 h-8', title }: RobotProps) {
  return <MascotPortrait name="Celly" className={className} title={title ?? 'Celly, RoboThink mascot'} />
}
