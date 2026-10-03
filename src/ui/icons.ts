import {
  createElement,
  type IconNode,
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeDollarSign,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Clock,
  Copy,
  Crosshair,
  Edit,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flame,
  Folder,
  GitMerge,
  Globe,
  GripVertical,
  Hash,
  HelpCircle,
  Info,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  Lock,
  Map,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Moon,
  Navigation,
  Orbit,
  Package,
  Pause,
  Pickaxe,
  Pin,
  PinOff,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShoppingCart,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareArrowOutUpRight,
  Sun,
  Swords,
  Target,
  Terminal,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  Activity,
  AlertTriangle,
  Archive: Package,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeDollarSign,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Clock,
  Copy,
  Crosshair,
  Edit,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flame,
  Folder,
  GitMerge,
  Globe,
  GripVertical,
  Hash,
  HelpCircle,
  Info,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  Lock,
  Map,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Moon,
  Navigation,
  Orbit,
  Package,
  Pause,
  Pickaxe,
  Pin,
  PinOff,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShoppingCart,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareArrowOutUpRight,
  Sun,
  Swords,
  Target,
  Terminal,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
};

function toPascalCase(str: string): string {
  return str.replace(/(^\w|-\w)/g, (clear) => clear.replace('-', '').toUpperCase());
}

export interface IconOptions {
  size?: number;
  className?: string;
  strokeWidth?: number;
  ariaHidden?: boolean;
}

function resolveIconNode(iconName: string): IconNode | undefined {
  const pascal = toPascalCase(iconName);
  return ICONS[pascal] || ICONS[iconName];
}

export function getLucideSvg(iconName: string, options: IconOptions = {}): string {
  const iconData = resolveIconNode(iconName);
  if (!iconData) return '';
  const size = options.size || 16;
  const stroke = options.strokeWidth || (size >= 24 ? 1.5 : 2);
  const cls = options.className ? ` class="${options.className}"` : '';
  const aria = options.ariaHidden !== false ? ' aria-hidden="true"' : '';
  const children = iconData
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"${cls}${aria}>${children}</svg>`;
}

export function createLucideElement(iconName: string, options: IconOptions = {}): SVGElement | null {
  const iconData = resolveIconNode(iconName);
  if (!iconData) return null;
  const size = options.size || 16;
  const stroke = options.strokeWidth || (size >= 24 ? 1.5 : 2);
  const el = createElement(iconData);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', String(stroke));
  el.setAttribute('stroke', 'currentColor');
  if (options.className) el.setAttribute('class', options.className);
  if (options.ariaHidden !== false) el.setAttribute('aria-hidden', 'true');
  return el;
}
