import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService } from "@/server/services";
import { EmailMessageRepository, CampaignRepository, LeadRepository } from "@/server/repositories";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));

    const businessId = session.business.id;
    const msgRepo = new EmailMessageRepository();
    const campRepo = new CampaignRepository();
    const leadRepo = new LeadRepository();

    const allMsgs = await msgRepo.listByBusiness(businessId);
    let outbound = allMsgs.filter((m) => !m.direction || m.direction.toLowerCase() === "outbound");

    if (search) {
      outbound = outbound.filter(
        (m) =>
          m.subject?.toLowerCase().includes(search) ||
          m.to_email?.toLowerCase().includes(search) ||
          m.body?.toLowerCase().includes(search)
      );
    }

    const total = outbound.length;
    const offset = (page - 1) * limit;
    const paged = outbound.slice(offset, offset + limit);

    // Enrich with campaign names and contact names
    const enriched = await Promise.all(
      paged.map(async (m) => {
        let campaignName: string | null = null;
        if (m.campaign_id) {
          try {
            const c = await campRepo.findByIdAndBusinessId(m.campaign_id, businessId);
            if (c) campaignName = c.name;
          } catch {}
        }

        let contactName: string | null = null;
        if (m.lead_id) {
          try {
            const l = await leadRepo.findByIdAndBusinessId(m.lead_id, businessId);
            if (l) contactName = `${l.first_name || ""} ${l.last_name || ""}`.trim() || null;
          } catch {}
        }

        const snippet = (m.body || "")
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);

        return {
          id: m.id,
          to_email: m.to_email,
          from_email: m.from_email,
          recipient_name: contactName || m.to_email,
          subject: m.subject || "No Subject",
          body: m.body || "",
          snippet,
          status: m.status?.toUpperCase() || "SENT",
          campaign_id: m.campaign_id,
          campaign_name: campaignName,
          sent_at: m.sent_at || m.created_at,
          created_at: m.created_at,
        };
      })
    );

    return NextResponse.json({
      success: true,
      messages: enriched,
      total,
      page,
      limit,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load sent emails";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
