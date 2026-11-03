/**
 * 内联图标集
 *
 * 统一 20 视窗、1.4 描边、currentColor,避免引入图标库。
 * 装饰性图标默认 aria-hidden,语义由外层按钮的 aria-label 承担。
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h14M3 10h14M3 14h14" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4v12M4 10h12" />
    </Svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.6 4.2l3.2 3.2M4 16l.9-3.1 7.7-7.7 3.2 3.2-7.7 7.7L4 16z" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 5.5h13M8 5.5V4h4v1.5M5.5 5.5l.7 10h7.6l.7-10M8.5 8.5v4.5M11.5 8.5v4.5" />
    </Svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="8" r="3.2" />
      <path d="M9.4 10.4L16 17M13.4 14.4l1.6-1.6M11.8 12.8l1.6-1.6" />
    </Svg>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h5v5H6.5c0 1.6-.8 2.5-2.5 3M11 6.5h5v5h-2.5c0 1.6-.8 2.5-2.5 3" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 8.5A6.2 6.2 0 105 14.5M16 4.5v4h-4" />
    </Svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 16V4M5 9l5-5 5 5" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5l5 5-5 5" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8l5 5 5-5" />
    </Svg>
  );
}
