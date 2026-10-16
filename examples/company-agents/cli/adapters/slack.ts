import { api, type Chat, type ChatMessage } from './types.ts';

/**
 * Slack. The bot token needs channels:history, chat:write and (for drafts shown to one person) chat:write.public is
 * not needed: the bot is invited to the channels in co.config.json and nowhere else. Approval of a drafted statement is
 * a reaction on the ephemeral draft, handled by the workflow that listens for reaction_added events.
 */

const API = 'https://slack.com/api';

type SlackResponse<T> = T & { ok: boolean; error?: string };

async function call<T>(method: string, token: string, body: Record<string, unknown>): Promise<T> {
  const result = await api<SlackResponse<T>>(`${API}/${method}`, { token, method: 'POST', body: JSON.stringify(body) });
  if (!result.ok) throw new Error(`Slack ${method}: ${result.error}`);
  return result;
}

export class SlackChat implements Chat {
  constructor(private token: string) {}

  async readThread(channel: string, ts: string): Promise<ChatMessage[]> {
    const result = await call<{ messages: { user?: string; text?: string; ts: string }[] }>('conversations.replies', this.token, { channel, ts, limit: 200 });
    return result.messages.map((m) => ({ user: m.user ?? 'unknown', text: m.text ?? '', ts: m.ts }));
  }

  async post(channel: string, text: string, threadTs?: string): Promise<string> {
    const result = await call<{ ts: string }>('chat.postMessage', this.token, { channel, text, thread_ts: threadTs, unfurl_links: false });
    return result.ts;
  }

  async postEphemeral(channel: string, user: string, text: string): Promise<void> {
    await call('chat.postEphemeral', this.token, { channel, user, text });
  }
}
