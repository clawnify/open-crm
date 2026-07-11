// Clawnify integrations — one place that wraps @clawnify/connections so the rest
// of the app never thinks about credentials or brokers. Every capability routes
// through connect(service, env).run(ACTION, args): the platform injects the
// CREDENTIALS binding + CLAWNIFY_ORG_ID at build time, resolves the org's
// connection, and executes the managed action. Off-platform (local `pnpm dev`)
// there's no binding, so isConnected() is false and the UI disables the buttons
// instead of failing.
//
// Action slugs + argument shapes verified against docs.composio.dev/toolkits/*.
// Keeping the (service, action) pairs here means a Composio rename is a one-line
// edit, not a hunt across the codebase.

import { connect, isConnected, type ConnectionsEnv } from "@clawnify/connections";

// Canonical service ids (never invent these — they come from the Clawnify
// connections catalog). googlesuper = Google Workspace (Gmail), googlecalendar =
// Google Calendar, slack = Slack. All Composio-managed.
export const SERVICES = {
  email: "googlesuper",
  meeting: "googlecalendar",
  slack: "slack",
} as const;

export interface ConnectionStatus {
  email: boolean;
  meeting: boolean;
  slack: boolean;
}

/** Which integrations the org has connected right now (drives UI enable/disable). */
export async function connectionStatus(env: ConnectionsEnv): Promise<ConnectionStatus> {
  const [email, meeting, slack] = await Promise.all([
    isConnected(SERVICES.email, env).catch(() => false),
    isConnected(SERVICES.meeting, env).catch(() => false),
    isConnected(SERVICES.slack, env).catch(() => false),
  ]);
  return { email, meeting, slack };
}

/** Send an email via the org's connected Gmail (Composio GOOGLESUPER_SEND_EMAIL). */
export async function sendEmail(
  env: ConnectionsEnv,
  args: { to: string; subject: string; body: string; isHtml?: boolean },
): Promise<unknown> {
  return connect(SERVICES.email, env).run("GOOGLESUPER_SEND_EMAIL", {
    recipient_email: args.to,
    subject: args.subject,
    body: args.body,
    is_html: args.isHtml ?? false,
  });
}

/** Create a Google Calendar event (Composio GOOGLECALENDAR_CREATE_EVENT). */
export async function createMeeting(
  env: ConnectionsEnv,
  args: {
    summary: string;
    startDatetime: string; // e.g. "2026-07-16T13:00:00" (no offset — timezone is separate)
    timezone: string; // e.g. "America/New_York"
    durationHour?: number;
    durationMinutes?: number;
    attendees?: string[]; // email strings
    description?: string;
  },
): Promise<unknown> {
  return connect(SERVICES.meeting, env).run("GOOGLECALENDAR_CREATE_EVENT", {
    summary: args.summary,
    start_datetime: args.startDatetime,
    timezone: args.timezone,
    event_duration_hour: args.durationHour ?? 0,
    event_duration_minutes: args.durationMinutes ?? 30,
    ...(args.attendees?.length ? { attendees: args.attendees } : {}),
    ...(args.description ? { description: args.description } : {}),
  });
}

/** Post a message to a Slack channel (Composio SLACK_SEND_MESSAGE). */
export async function notifySlack(
  env: ConnectionsEnv,
  args: { channel: string; text: string },
): Promise<unknown> {
  return connect(SERVICES.slack, env).run("SLACK_SEND_MESSAGE", {
    channel: args.channel,
    markdown_text: args.text,
  });
}
