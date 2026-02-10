import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  findConnectionById,
  disconnectConnection,
  updateConnection,
  resetConnection,
} from "@/lib/whatsapp/connections";
import { resendIntroductionMessage } from "@/lib/whatsapp/intro-message";
import { z } from "zod";

const DisconnectSchema = z.object({
  conversationAction: z.enum(["keep", "archive", "delete"]).default("keep"),
  reason: z.string().optional(),
});

const ReconnectSchema = z.object({
  sendIntroMessage: z.boolean().default(true),
});

/**
 * GET /api/agents/[id]/whatsapp/connections/[connectionId]
 * Get connection details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: agentId, connectionId } = await params;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const connection = await findConnectionById(connectionId);

    if (!connection || connection.agent_id !== agentId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Verify ownership
    const { data: agent } = await supabase
      .from("vibe_agents")
      .select("id")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json({ connection });
  } catch (error) {
    console.error("Error fetching connection:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/agents/[id]/whatsapp/connections/[connectionId]
 * Update connection (disconnect, reconnect, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: agentId, connectionId } = await params;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const { data: agent } = await supabase
      .from("vibe_agents")
      .select("*")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const connection = await findConnectionById(connectionId);

    if (!connection || connection.agent_id !== agentId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action as string;

    // Handle different actions
    switch (action) {
      case "disconnect": {
        const validated = DisconnectSchema.parse(body);

        // Handle conversation cleanup
        if (validated.conversationAction === "delete") {
          await supabase
            .from("vibe_agent_conversations")
            .delete()
            .eq("whatsapp_connection_id", connectionId);
        } else if (validated.conversationAction === "archive") {
          await supabase
            .from("vibe_agent_conversations")
            .update({ closed_at: new Date().toISOString() })
            .eq("whatsapp_connection_id", connectionId);
        }

        const updated = await disconnectConnection(connectionId, validated.reason);

        return NextResponse.json({
          connection: updated,
          message: "Connection disconnected successfully",
        });
      }

      case "reconnect": {
        const validated = ReconnectSchema.parse(body);

        const updated = await updateConnection(connectionId, {
          status: "active",
          connected_at: new Date(),
          disconnected_at: undefined,
          disconnection_reason: undefined,
        });

        // Optionally resend intro
        if (validated.sendIntroMessage) {
          await resendIntroductionMessage(connectionId, agent);
        }

        return NextResponse.json({
          connection: updated,
          message: "Connection reconnected successfully",
        });
      }

      case "reset": {
        await resetConnection(connectionId);

        return NextResponse.json({
          message: "Connection reset successfully. All conversations closed.",
        });
      }

      case "resend_intro": {
        const sent = await resendIntroductionMessage(connectionId, agent);

        if (!sent) {
          return NextResponse.json(
            { error: "Failed to send introduction message" },
            { status: 500 }
          );
        }

        return NextResponse.json({
          message: "Introduction message resent successfully",
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error updating connection:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[id]/whatsapp/connections/[connectionId]
 * Permanently delete connection
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: agentId, connectionId } = await params;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const { data: agent } = await supabase
      .from("vibe_agents")
      .select("id")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const connection = await findConnectionById(connectionId);

    if (!connection || connection.agent_id !== agentId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Delete connection (cascades to conversations if configured)
    await supabase
      .from("whatsapp_agent_connections")
      .delete()
      .eq("id", connectionId);

    return NextResponse.json({
      message: "Connection deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting connection:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
