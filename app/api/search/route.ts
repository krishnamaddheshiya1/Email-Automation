import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AuthService,
  replyService,
  contactService,
  campaignService,
  templateService,
} from "@/server/services";
import { EmailMessageRepository } from "@/server/repositories";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  snippet?: string;
  href: string;
  badge?: string;
  timestamp?: string;
}

export interface GroupedSearchResults {
  emails: SearchResultItem[];
  contacts: SearchResultItem[];
  campaigns: SearchResultItem[];
  templates: SearchResultItem[];
}

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
    const query = (searchParams.get("q") || "").trim();

    if (!query) {
      return NextResponse.json({
        success: true,
        query: "",
        results: { emails: [], contacts: [], campaigns: [], templates: [] },
        total: 0,
      });
    }

    const businessId = session.business.id;
    const qLower = query.toLowerCase();

    // 1. Search Conversations & Replies
    const convosResult = await replyService.listConversations({
      businessId,
      search: query,
      limit: 6,
    });

    const emailResults: SearchResultItem[] = (convosResult.conversations || []).map((c) => ({
      id: c.id,
      title: c.contact_name || c.contact_email || "Customer Reply",
      subtitle: c.subject || "No Subject",
      snippet: c.snippet,
      href: `/inbox?id=${c.id}`,
      badge: c.unread_count > 0 ? "Unread Reply" : "Reply",
      timestamp: c.last_message_at || c.created_at,
    }));

    // If fewer than 4 results, also search outbound email messages
    if (emailResults.length < 4) {
      try {
        const msgRepo = new EmailMessageRepository();
        const allMsgs = await msgRepo.listByBusiness(businessId);
        const matchedMsgs = allMsgs
          .filter(
            (m) =>
              m.subject?.toLowerCase().includes(qLower) ||
              m.to_email?.toLowerCase().includes(qLower) ||
              m.body?.toLowerCase().includes(qLower)
          )
          .slice(0, 4 - emailResults.length);

        for (const m of matchedMsgs) {
          if (!emailResults.some((e) => e.id === m.id)) {
            emailResults.push({
              id: m.id,
              title: m.to_email,
              subtitle: m.subject || "Outbound Email",
              snippet: (m.body || "").replace(/<[^>]*>/g, "").slice(0, 100),
              href: `/sent?id=${m.id}`,
              badge: m.status?.toUpperCase() || "SENT",
              timestamp: m.sent_at || m.created_at,
            });
          }
        }
      } catch {}
    }

    // 2. Search Contacts
    let contactResults: SearchResultItem[] = [];
    try {
      const contactsRes = await contactService.listContacts(businessId, {
        search: query,
        limit: 5,
      });
      contactResults = (contactsRes.data || []).map((l) => ({
        id: l.id,
        title: `${l.first_name || ""} ${l.last_name || ""}`.trim() || l.email,
        subtitle: l.email,
        href: `/contacts/${l.id}`,
        badge: l.status?.toUpperCase() || "LEAD",
        timestamp: l.created_at,
      }));
    } catch {}

    // 3. Search Campaigns
    let campaignResults: SearchResultItem[] = [];
    try {
      const campsRes = await campaignService.listCampaigns(businessId, {
        search: query,
        limit: 5,
      });
      campaignResults = (campsRes.data || []).map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.status} • ${(c as unknown as { steps?: unknown[] }).steps?.length || 0} steps`,
        href: `/campaigns/${c.id}`,
        badge: c.status,
        timestamp: c.created_at,
      }));
    } catch {}

    // 4. Search Templates
    let templateResults: SearchResultItem[] = [];
    try {
      const templRes = await templateService.listTemplates(businessId, {
        search: query,
        limit: 5,
      });
      templateResults = (templRes.data || []).map((t) => ({
        id: t.id,
        title: t.name,
        subtitle: `Subject: ${t.subject}`,
        href: `/templates/${t.id}`,
        badge: t.status || "ACTIVE",
        timestamp: t.updated_at || t.created_at,
      }));
    } catch {}

    const total =
      emailResults.length +
      contactResults.length +
      campaignResults.length +
      templateResults.length;

    return NextResponse.json({
      success: true,
      query,
      results: {
        emails: emailResults,
        contacts: contactResults,
        campaigns: campaignResults,
        templates: templateResults,
      },
      total,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Search query failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
