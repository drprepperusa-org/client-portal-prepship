import {
  LayoutDashboard,
  ShoppingCart,
  PackageOpen,
  Truck,
  Undo2,
  Boxes,
  LineChart,
  ReceiptText,
  Tags,
  Plug,
  Settings,
  Component,
  type LucideIcon,
} from 'lucide-react';
import type { Accent } from '@/lib/accents';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  accent: Accent;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, accent: 'indigo' },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, accent: 'sky' },
  { to: '/inbound', label: 'Inbound', icon: PackageOpen, accent: 'violet' },
  { to: '/shipments', label: 'Shipments', icon: Truck, accent: 'teal' },
  { to: '/returns', label: 'Returns', icon: Undo2, accent: 'rose' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, accent: 'amber' },
  { to: '/analysis', label: 'Analysis', icon: LineChart, accent: 'rose' },
  { to: '/billing', label: 'Billing', icon: ReceiptText, accent: 'sky' },
  { to: '/rates', label: 'Rate Sheet', icon: Tags, accent: 'amber' },
  { to: '/connections', label: 'Connections', icon: Plug, accent: 'teal' },
  { to: '/settings', label: 'Settings', icon: Settings, accent: 'violet' },
];

export const COMPONENTS_NAV: NavItem = { to: '/components', label: 'Components', icon: Component, accent: 'rose' };
