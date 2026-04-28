import { useTheme } from '../contexts/ThemeContext';

interface Props {
  size?: number;
  /** "completa" includes wordmark; "solo" is just the symbol. */
  variant?: 'solo' | 'completa';
  /** "outlined" picks the *-vazada (hollow) version. Default is solid. */
  outlined?: boolean;
  className?: string;
  /** Force a theme variant regardless of current theme. Useful for fixed-bg contexts. */
  forceTheme?: 'dark' | 'light';
}

/**
 * Official LA Music wordmark/symbol.
 * Naming convention in /public:
 *   logo-la-music-{theme}-{variant}{-vazada}?.svg
 * where:
 *   theme   = "dark" (use on dark bg, has white fills) | "light" (use on light bg, has #373435)
 *   variant = "solo" | "completa"
 *   vazada  = optional outlined version
 *
 * Per LA-Organizer-UI-SYSTEM.md §8: never recreate the logo, always use the SVGs.
 */
export function LogoMark({ size, variant = 'solo', outlined, className = '', forceTheme }: Props) {
  const { theme } = useTheme();
  const t = forceTheme ?? theme;
  const file = `/logo-la-music-${t}-${variant}${outlined ? '-vazada' : ''}.svg`;

  // Default heights chosen for visual parity at common usage sizes.
  // solo defaults to 40 (avatar-ish), completa defaults to 36 (wordmark height).
  const h = size ?? (variant === 'solo' ? 40 : 36);

  return (
    <img
      src={file}
      alt="LA Music"
      height={h}
      style={{ height: h, width: 'auto', display: 'inline-block' }}
      className={className}
      draggable={false}
    />
  );
}
