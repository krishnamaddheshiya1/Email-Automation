import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, replyService } from "@/server/services";
import { SafetyAuditRepository } from "@/server/repositories";

export interface NotificationItem {
  id: string;
  type: "reply" | "audit" | "system" | "bounce";
  title: string;
  message: string;
  href: string;
  createdAt: string;
  isRead: boolean;
  severity: "info" | "warning" | "error" | "success";
}

export async function GET() {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.business.id;
    const notifications: NotificationItem[] = [];

    // 1. Unread Inbound Replies
    try {
      const convos = await replyService.listConversations({
        businessId,
        filter: "unread",
        limit: 5,
      });

      for (const c of convos.conversations || []) {
        notifications.push({
          id: `reply_${c.id}`,
          type: "reply",
          title: `New reply from ${c.contact_name || c.contact_email}`,
          message: c.snippet || c.subject || "Customer sent an email reply",
          href: `/inbox?id=${c.id}`,
          createdAt: c.last_message_at || c.created_at,
          isRead: false,
          severity: "info",
        });
      }
    } catch {}

    // 2. Safety Audit Logs
    try {
      const auditRepo = new SafetyAuditRepository();
      const logs = await auditRepo.listByBusiness(businessId, 6);
      for (const log of logs || []) {
        const isSecurity = log.event_type.includes("security") || log.event_type.includes("violation");
        const isWarning = log.event_type.includes("limit") || log.event_type.includes("suppression");
        notifications.push({
          id: `audit_${log.id}`,
          type: "audit",
          title: log.event_type.replace(/_/g, " ").toUpperCase(),
          message: log.reason || "Automated deliverability event logged",
          href: "/settings",
          createdAt: log.created_at,
          isRead: true,
          severity: isSecurity ? "error" : isWarning ? "warning" : "info",
        });
      }
    } catch {}

    // Sort by newest first
    notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return NextResponse.json({
      success: true,
      unreadCount,
      notifications: notifications.slice(0, 10),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load notifications";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
