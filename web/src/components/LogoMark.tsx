interface Props {
  size?: number;
  variant?: 'pink' | 'mono';
  className?: string;
}

/**
 * Inline logo mark — geometric "LA" wordmark with brand sentinel block.
 * Replace with the official SVG from branding when available.
 * Uses tokens from LA-Organizer-UI-SYSTEM (§5.1, §8).
 */
export function LogoMark({ size = 40, variant = 'pink', className = '' }: Props) {
  const fill = variant === 'pink' ? '#E91451' : 'currentColor';
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="LA Organizer"
      className={className}
    >
      <rect x="2" y="2" width="60" height="60" rx="10" fill={fill} />
      <text
        x="50%"
        y="55%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#FFFFFF"
        fontFamily="Prompt, sans-serif"
        fontWeight="900"
        fontSize="30"
        letterSpacing="-2"
      >
        LA
      </text>
    </svg>
  );
}
