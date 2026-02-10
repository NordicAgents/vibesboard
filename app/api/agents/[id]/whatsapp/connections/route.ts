import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createConnection, listAgentConnections } from "@/lib/whatsapp/connections";
import { sendIntroductionMessage } from "@/lib/whatsapp/intro-message";
import { z } from "zod";

const CreateConnectionSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Invalid phone number format. Use E.164 format (e.g., +919400293288)"),
  customIntroMessage: z.string().optional(),
  sendIntroImmediately: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
});

/**
 * POST /api/agents/[id]/whatsapp/connections
 * Create new WhatsApp connection for agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: agentId } = await params;

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify agent ownership
    const { data: agent, error: agentError } = await supabase
      .from("vibe_agents")
      .select("*")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found or unauthorized" }, { status: 404 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validated = CreateConnectionSchema.parse(body);

    // Create connection
    const connection = await createConnection(
      {
        agent_id: agentId,
        phone_number: validated.phoneNumber,
        custom_intro_message: validated.customIntroMessage,
        expires_at: validated.expiresAt ? new Date(validated.expiresAt) : undefined,
      },
      user.id
    );

    if (!connection) {
      return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
    }

    // Send introduction message if requested
    let introMessageSent = false;
    if (validated.sendIntroImmediately) {
      introMessageSent = await sendIntroductionMessage(connection, agent);
    }

    return NextResponse.json(
      {
        connection,
        introMessageSent,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating WhatsApp connection:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/agents/[id]/whatsapp/connections?status=active
 * List WhatsApp connections for agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: agentId } = await params;

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify agent ownership
    const { data: agent } = await supabase
      .from("vibe_agents")
      .select("id")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or unauthorized" }, { status: 404 });
    }

    // Get status filter from query params
    const status = request.nextUrl.searchParams.get("status") || undefined;

    // List connections
    const connections = await listAgentConnections(agentId, status);

    return NextResponse.json({
      connections,
      total: connections.length,
    });
  } catch (error) {
    console.error("Error listing WhatsApp connections:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
