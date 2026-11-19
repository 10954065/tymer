"use client";

import {
  ArrowLeftRight,
  BadgeDollarSign,
  Boxes,
  ClipboardList,
  FileBarChart2,
  FolderTree,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavGroup, NavIcon } from "@/lib/navigation";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  sales: History,
  products: Package,
  categories: FolderTree,
  inventory: Boxes,
  purchases: Truck,
  suppliers: Users,
  customers: Users,
  orders: ClipboardList,
  expenses: Receipt,
  payments: ArrowLeftRight,
  reports: FileBarChart2,
  cash: Wallet,
  audit: ScrollText,
  staff: UserCog,
  settings: Settings,
};

export interface ShellUser {
  fullName: string;
  username: string;
  role: Role;
}

interface AppShellProps {
  navigation: NavGroup[];
  user: ShellUser;
  businessName: string;
  headerExtras?: ReactNode;
  children: ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ navigation }: { navigation: NavGroup[] }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <>
      {navigation.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
            {group.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary"
                    >
                      <Link href={item.href} onClick={() => isMobile && setOpenMobile(false)}>
                        <Icon aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

export function AppShell({ navigation, user, businessName, headerExtras, children }: AppShellProps) {
  return (
    <TooltipProvider delayDuration={250}>
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="px-3 pt-4 pb-2">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <BadgeDollarSign className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block font-heading text-[0.95rem] leading-tight font-semibold">SmartLiving</span>
              <span className="block truncate text-[0.65rem] tracking-wide text-sidebar-foreground/60 uppercase">{businessName}</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <NavLinks navigation={navigation} />
        </SidebarContent>
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-xs">
            <p className="truncate font-medium">{user.fullName}</p>
            <p className="text-sidebar-foreground/60">{ROLE_LABELS[user.role]}</p>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <div className="ml-auto flex items-center gap-1.5">
            {headerExtras}
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-6 sm:py-7">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
    </TooltipProvider>
  );
}
