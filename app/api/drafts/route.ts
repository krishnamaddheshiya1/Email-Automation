import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService, templateService } from "@/server/services";

export interface DraftItem {
  id: string;
  type: "campaign" | "template";
  title: string;
  subject?: string;
  updated_at: string;
  href: string;
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
    const drafts: DraftItem[] = [];

    // 1. Draft Campaigns
    try {
      const campaignsRes = await campaignService.listCampaigns(businessId, {
        status: "DRAFT",
        limit: 50,
      });
      for (const c of campaignsRes.data || []) {
        drafts.push({
          id: c.id,
          type: "campaign",
          title: c.name,
          updated_at: c.updated_at || c.created_at,
          href: `/campaigns/${c.id}`,
        });
      }
    } catch {}

    // 2. Draft Templates
    try {
      const templatesRes = await templateService.listTemplates(businessId, {
        limit: 50,
      });
      for (const t of templatesRes.data || []) {
        if (t.status === "draft") {
          drafts.push({
            id: t.id,
            type: "template",
            title: t.name,
            subject: t.subject,
            updated_at: t.updated_at || t.created_at,
            href: `/templates/${t.id}`,
          });
        }
      }
    } catch {}

    // Sort by latest update
    drafts.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return NextResponse.json({
      success: true,
      drafts,
      total: drafts.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load drafts";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
