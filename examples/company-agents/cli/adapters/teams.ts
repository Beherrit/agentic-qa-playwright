import { api, type Chat, type ChatMessage } from './types.ts';

/**
 * Microsoft Teams through an incoming webhook: post only. Reading a thread and posting to one person need a bot
 * registration and the Graph API (ChatMessage.Read.All, ChannelMessage.Send); the methods say so rather than pretend.
 * With a webhook, the chat responder can still answer questions it was given in full (from `co post`), and the digest
 * and triage notes can be posted; approval of statements happens in the CLI instead of by reaction.
 */
export class TeamsChat implements Chat {
  constructor(private webhookUrl: string) {}

  async readThread(): Promise<ChatMessage[]> {
    throw new Error('Reading a Teams thread needs a Graph API bot registration; the webhook adapter cannot. See adapters/teams.ts.');
  }

  async post(_channel: string, text: string): Promise<string> {
    await api(this.webhookUrl, {
      method: 'POST',
      body: JSON.stringify({
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }] } }],
      }),
    });
    return new Date().toISOString();
  }

  async postEphemeral(): Promise<void> {
    throw new Error('A Teams webhook cannot post to one person. Use the CLI preview and confirmation instead.');
  }
}
