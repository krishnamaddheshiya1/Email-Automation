export interface NavItem {
  title: string;
  href: string;
  disabled?: boolean;
  external?: boolean;
  badge?: string;
}

export interface SidebarSection {
  title: string;
  items: NavItem[];
}
