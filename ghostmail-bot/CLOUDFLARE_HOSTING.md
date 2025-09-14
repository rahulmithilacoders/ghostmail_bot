# Hosting GhostMail Bot on Cloudflare Workers

This guide will help you deploy your GhostMail Telegram bot to Cloudflare Workers for 24/7 hosting with webhooks.

## Why Cloudflare Workers?

- ✅ **Free tier**: 100,000 requests/day
- ✅ **Global edge locations**: Low latency worldwide  
- ✅ **Serverless**: No server management needed
- ✅ **Webhooks**: More reliable than polling
- ✅ **Always online**: 24/7 availability

## Prerequisites

1. Cloudflare account (free)
2. Node.js installed locally
3. Your bot token and API keys

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

## Step 2: Login to Cloudflare

```bash
wrangler login
```

This will open your browser to authenticate with Cloudflare.

## Step 3: Create Cloudflare Worker Project

In your `ghostmail-bot` directory:

```bash
wrangler init ghostmail-worker --type webpack
```

Choose:
- ✅ Yes to TypeScript 
- ✅ Yes to deploy

## Step 4: Create Worker Code

Replace the contents of `src/index.ts` with:

```typescript
export interface Env {
  BOT_TOKEN: string;
  GHOSTMAIL_API_KEY: string;
  GHOSTMAIL_BASE_URL: string;
}

// Store user sessions (in production, use Cloudflare KV)
const userSessions = new Map();

// Utility function to strip HTML tags and format text safely for Telegram
function stripHtmlAndFormat(html: string): string {
  if (!html) return '';
  
  // Remove script and style content completely
  let text = html.replace(/<script[^>]*>.*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>.*?<\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');
  text = text.replace(/&hellip;/g, '...');
  text = text.replace(/&copy;/g, '©');
  text = text.replace(/&reg;/g, '®');
  text = text.replace(/&trade;/g, '™');
  
  // Remove control characters and problematic Unicode
  text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Control characters
  text = text.replace(/[\u2000-\u206F]/g, ' '); // Special spaces
  text = text.replace(/[\uFFF0-\uFFFF]/g, ''); // Specials
  
  // Remove extra whitespace and normalize line breaks
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();
  
  // Escape Telegram Markdown special characters that could cause parsing errors
  text = text.replace(/([_*[\]()~`>#+-=|{}.!\\])/g, '\\$1');
  
  // Limit length to prevent oversized messages
  if (text.length > 3000) {
    text = text.substring(0, 3000) + '...\n\n[Message truncated due to length]';
  }
  
  return text;
}

// Utility function to truncate text with proper word boundaries
function truncateText(text: string, maxLength: number = 200): string {
  if (!text || text.length <= maxLength) return text;
  
  // Find the last space within the limit
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  // If we find a space, cut there, otherwise use the full truncated length
  const cutPoint = lastSpace > maxLength * 0.8 ? lastSpace : maxLength;
  
  return text.substring(0, cutPoint) + '...';
}

// Function to split long messages into chunks
function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  let currentChunk = '';
  const lines = text.split('\n');
  
  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // If a single line is too long, split it
      if (line.length > maxLength) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + word + ' ').length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
          }
          currentChunk += word + ' ';
        }
      } else {
        currentChunk = line + '\n';
      }
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

class GhostmailAPI {
  constructor(private apiKey: string, private baseUrl: string) {}

  async getDomains() {
    try {
      const response = await fetch(`${this.baseUrl}/domains/${this.apiKey}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching domains:', error);
      return null;
    }
  }

  async createEmail() {
    try {
      const response = await fetch(`${this.baseUrl}/email/create/${this.apiKey}`, {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error('Error creating email:', error);
      return null;
    }
  }

  async getMessages(emailToken: string) {
    try {
      const response = await fetch(`${this.baseUrl}/messages/${emailToken}/${this.apiKey}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching messages:', error);
      return null;
    }
  }

  async deleteEmail(emailToken: string) {
    try {
      const response = await fetch(`${this.baseUrl}/email/delete/${emailToken}/${this.apiKey}`, {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error('Error deleting email:', error);
      return null;
    }
  }

  async getMessage(messageId: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/${messageId}/${this.apiKey}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching message:', error);
      return null;
    }
  }

  async deleteMessage(messageId: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/delete/${messageId}/${this.apiKey}`, {
        method: 'POST'
      });
      return await response.json();
    } catch (error) {
      console.error('Error deleting message:', error);
      return null;
    }
  }
}

class TelegramBot {
  constructor(private token: string, private api: GhostmailAPI) {}

  async sendMessage(chatId: number, text: string, options: any = {}) {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: options.parse_mode || 'Markdown',
      reply_markup: options.reply_markup || null
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await response.json();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  async answerCallbackQuery(callbackQueryId: string) {
    const url = `https://api.telegram.org/bot${this.token}/answerCallbackQuery`;
    
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId })
      });
    } catch (error) {
      console.error('Error answering callback:', error);
    }
  }

  async handleStart(chatId: number) {
    const welcomeMessage = `🔒 **Welcome to GhostMail Bot!**

I can help you create temporary email addresses for privacy and security.

**Available Commands:**
/create - Create a new temporary email
/messages - Check your inbox
/domains - View available domains
/delete - Delete current email
/help - Show this help message

Ready to get started? Use /create to generate your first temporary email! 📧`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📧 Create Email', callback_data: 'create_email' }],
          [{ text: '📥 Check Messages', callback_data: 'check_messages' }],
          [{ text: '🌐 View Domains', callback_data: 'view_domains' }]
        ]
      }
    };

    await this.sendMessage(chatId, welcomeMessage, options);
  }

  async handleCreateEmail(chatId: number) {
    await this.sendMessage(chatId, '⏳ Creating your temporary email...');
    
    const result = await this.api.createEmail();
    
    if (result && result.status === 'success') {
      const emailData = result.data;
      userSessions.set(chatId, {
        email: emailData.email,
        token: emailData.email_token,
        expiresAt: emailData.deleted_in
      });
      
      const message = `✅ **Email Created Successfully!**

📧 **Your Email:** \`${emailData.email}\`
⏰ **Expires:** ${emailData.deleted_in}

You can now use this email for registrations.`;

      const options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Check Messages', callback_data: 'check_messages' }],
            [{ text: '🔄 Create New', callback_data: 'create_email' }, { text: '🗑️ Delete', callback_data: 'delete_email' }]
          ]
        }
      };
      
      await this.sendMessage(chatId, message, options);
    } else {
      await this.sendMessage(chatId, '❌ Failed to create email. Please try again.');
    }
  }

  async handleCheckMessages(chatId: number) {
    const session = userSessions.get(chatId);
    
    if (!session) {
      await this.sendMessage(chatId, '❌ No active email session. Create an email first.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📧 Create Email', callback_data: 'create_email' }]
          ]
        }
      });
      return;
    }
    
    await this.sendMessage(chatId, '📬 Checking your messages...');
    
    const result = await this.api.getMessages(session.token);
    
    if (result && result.status === 'success') {
      const messages = result.data.messages;
      
      if (messages.length === 0) {
        await this.sendMessage(chatId, `📭 No messages found in ${session.email}\n\nYour inbox is currently empty.`);
        return;
      }
      
      let messageText = `📬 **Inbox for ${session.email}**\n\n`;
      
      // If too many messages, show only recent ones
      const maxMessagesPerPage = 5;
      const totalMessages = messages.length;
      const messagesToShow = messages.slice(0, maxMessagesPerPage);
      
      if (totalMessages > maxMessagesPerPage) {
        messageText += `📊 Showing ${maxMessagesPerPage} of ${totalMessages} messages\n\n`;
      }
      
      messagesToShow.forEach((message: any, index: number) => {
        const readStatus = message.is_seen ? '✅' : '🔵';
        const cleanContent = stripHtmlAndFormat(message.content);
        
        messageText += `${readStatus} **Message ${index + 1}**\n`;
        messageText += `👤 **From:** ${message.from}\n`;
        messageText += `📧 **Email:** ${message.from_email}\n`;
        messageText += `📄 **Subject:** ${message.subject || 'No Subject'}\n`;
        messageText += `📅 **Received:** ${message.receivedAt}\n`;
        
        if (message.attachments && message.attachments.length > 0) {
          messageText += `📎 **Attachments:** ${message.attachments.length} file(s)\n`;
          message.attachments.forEach((attachment: any, attIndex: number) => {
            messageText += `   ${attIndex + 1}. ${attachment.file}\n`;
          });
        }
        
        messageText += `\n💌 **Full Content:**\n${cleanContent}\n`;
        messageText += `━━━━━━━━━━━━━━━\n\n`;
      });
      
      // Add summary if there are more messages
      if (totalMessages > maxMessagesPerPage) {
        messageText += `📬 You have ${totalMessages - maxMessagesPerPage} more messages.`;
      }
      
      // Create simple keyboard with standard options
      const keyboard = [
        [{ text: '🔄 Refresh', callback_data: 'check_messages' }],
        [{ text: '📧 New Email', callback_data: 'create_email' }]
      ];
      
      // Add delete buttons for individual messages if there are messages to delete
      if (messagesToShow.length > 0 && messagesToShow.length <= 3) {
        const deleteButtons: any[] = [];
        messagesToShow.forEach((message: any, index: number) => {
          deleteButtons.push({ 
            text: `🗑️ Delete Msg ${index + 1}`, 
            callback_data: `delete_msg_${message.id}` 
          });
        });
        
        // Add delete buttons in rows of 2
        for (let i = 0; i < deleteButtons.length; i += 2) {
          const row = deleteButtons.slice(i, i + 2);
          keyboard.splice(-1, 0, row); // Insert before the last row
        }
      }
      
      const options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      };
      
      // Split message if too long and send in chunks
      const messageChunks = splitMessage(messageText);
      
      for (let i = 0; i < messageChunks.length; i++) {
        const chunk = messageChunks[i];
        const chunkOptions = i === messageChunks.length - 1 ? options : { parse_mode: 'Markdown' };
        
        try {
          await this.sendMessage(chatId, chunk, chunkOptions);
          // Add small delay between chunks
          if (i < messageChunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error('Error sending message chunk:', error);
          // If markdown fails, try without formatting
          const plainChunk = chunk.replace(/\*\*/g, '').replace(/`/g, '');
          await this.sendMessage(chatId, plainChunk, 
            i === messageChunks.length - 1 ? { reply_markup: options.reply_markup } : {});
        }
      }
    } else {
      await this.sendMessage(chatId, '❌ Failed to fetch messages. Please try again.');
    }
  }

  async handleDeleteEmail(chatId: number) {
    const session = userSessions.get(chatId);
    
    if (!session) {
      await this.sendMessage(chatId, '❌ No active email session to delete.');
      return;
    }
    
    await this.sendMessage(chatId, '🗑️ Deleting your current email...');
    
    const result = await this.api.deleteEmail(session.token);
    
    if (result && result.status === 'success') {
      userSessions.delete(chatId);
      
      const message = `✅ **Email Deleted Successfully!**

Your previous email has been deleted.`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📧 Create New Email', callback_data: 'create_email' }]
          ]
        }
      };
      
      await this.sendMessage(chatId, message, options);
    } else {
      await this.sendMessage(chatId, '❌ Failed to delete email. Please try again.');
    }
  }

  async handleViewDomains(chatId: number) {
    const result = await this.api.getDomains();
    
    if (result && result.status === 'success') {
      const domains = result.data.domains;
      let domainText = '🌐 **Available Domains:**\n\n';
      
      Object.values(domains).forEach((domain: any, index) => {
        domainText += `${index + 1}. ${domain}\n`;
      });
      
      await this.sendMessage(chatId, domainText, { parse_mode: 'Markdown' });
    } else {
      await this.sendMessage(chatId, '❌ Failed to fetch domains. Please try again.');
    }
  }

  async handleViewFullMessage(chatId: number, messageId: string) {
    const session = userSessions.get(chatId);
    
    if (!session) {
      await this.sendMessage(chatId, '❌ No active email session.');
      return;
    }
    
    await this.sendMessage(chatId, '📖 Loading full message...');
    
    const messageResult = await this.api.getMessage(messageId);
    
    if (messageResult && messageResult.status === 'success' && messageResult.data.length > 0) {
      const fullMessage = messageResult.data[0];
      const cleanContent = stripHtmlAndFormat(fullMessage.content);
      
      let fullMessageText = `📧 **Full Message**\n\n`;
      fullMessageText += `👤 **From:** ${fullMessage.from}\n`;
      fullMessageText += `📧 **Email:** ${fullMessage.from_email}\n`;
      fullMessageText += `📄 **Subject:** ${fullMessage.subject || 'No Subject'}\n`;
      fullMessageText += `📅 **Received:** ${fullMessage.receivedAt}\n`;
      
      if (fullMessage.attachments && fullMessage.attachments.length > 0) {
        fullMessageText += `📎 **Attachments:** ${fullMessage.attachments.length} file(s)\n`;
        fullMessage.attachments.forEach((attachment: any, index: number) => {
          fullMessageText += `   ${index + 1}. ${attachment.file}\n`;
        });
      }
      
      fullMessageText += `\n💌 **Full Content:**\n${cleanContent}\n`;
      
      const backOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Inbox', callback_data: 'check_messages' }],
            [{ text: '🗑️ Delete Message', callback_data: `delete_msg_${messageId}` }]
          ]
        }
      };
      
      // Split message if too long
      const messageChunks = splitMessage(fullMessageText);
      
      for (let i = 0; i < messageChunks.length; i++) {
        const chunk = messageChunks[i];
        const chunkOptions = i === messageChunks.length - 1 ? backOptions : { parse_mode: 'Markdown' };
        
        try {
          await this.sendMessage(chatId, chunk, chunkOptions);
          if (i < messageChunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error('Error sending full message chunk:', error);
          const plainChunk = chunk.replace(/\*\*/g, '').replace(/`/g, '');
          await this.sendMessage(chatId, plainChunk, 
            i === messageChunks.length - 1 ? { reply_markup: backOptions.reply_markup } : {});
        }
      }
    } else {
      await this.sendMessage(chatId, '❌ Failed to load full message. It may have been deleted.');
    }
  }

  async handleDeleteSingleMessage(chatId: number, messageId: string) {
    await this.sendMessage(chatId, '🗑️ Deleting message...');
    
    const deleteResult = await this.api.deleteMessage(messageId);
    
    if (deleteResult && deleteResult.status === 'success') {
      await this.sendMessage(chatId, '✅ Message deleted successfully!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Back to Inbox', callback_data: 'check_messages' }]
          ]
        }
      });
    } else {
      await this.sendMessage(chatId, '❌ Failed to delete message.');
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const api = new GhostmailAPI(env.GHOSTMAIL_API_KEY, env.GHOSTMAIL_BASE_URL);
    const bot = new TelegramBot(env.BOT_TOKEN, api);

    try {
      const update = await request.json() as any;
      
      // Handle regular messages
      if (update.message) {
        const message = update.message;
        const chatId = message.chat.id;
        const text = message.text;

        if (text === '/start') {
          await bot.handleStart(chatId);
        } else if (text === '/create') {
          await bot.handleCreateEmail(chatId);
        } else if (text === '/messages') {
          await bot.handleCheckMessages(chatId);
        } else if (text === '/domains') {
          await bot.handleViewDomains(chatId);
        } else if (text === '/delete') {
          await bot.handleDeleteEmail(chatId);
        } else if (text === '/help') {
          await bot.handleStart(chatId);
        }
      }
      
      // Handle callback queries
      if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        
        await bot.answerCallbackQuery(callbackQuery.id);
        
        switch (data) {
          case 'create_email':
            await bot.handleCreateEmail(chatId);
            break;
          case 'check_messages':
            await bot.handleCheckMessages(chatId);
            break;
          case 'view_domains':
            await bot.handleViewDomains(chatId);
            break;
          case 'delete_email':
            await bot.handleDeleteEmail(chatId);
            break;
          default:
            // Handle view_message_ callbacks
            if (data.startsWith('view_message_')) {
              const messageId = data.replace('view_message_', '');
              await bot.handleViewFullMessage(chatId, messageId);
            }
            // Handle delete_msg_ callbacks
            else if (data.startsWith('delete_msg_')) {
              const messageId = data.replace('delete_msg_', '');
              await bot.handleDeleteSingleMessage(chatId, messageId);
            }
            break;
        }
      }

      return new Response('OK');
    } catch (error) {
      console.error('Error processing update:', error);
      return new Response('Error', { status: 500 });
    }
  },
};
```

## Step 5: Configure Environment Variables

Edit `wrangler.toml`:

```toml
name = "ghostmail-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production.vars]
GHOSTMAIL_BASE_URL = "https://ghostmail.one/api"

[env.production]
name = "ghostmail-worker"
```

Add secrets (sensitive data):

```bash
wrangler secret put BOT_TOKEN
# Enter: 8473632705:AAERjB2sxFxD_oc7U4GjQbxsCtDT3E1feIk

wrangler secret put GHOSTMAIL_API_KEY  
# Enter: ubWVu8ElinibrQtB63GXSibL5Z3Ti1FM3T2FeXPa
```

## Step 6: Deploy to Cloudflare

```bash
wrangler deploy
```

You'll get a URL like: `https://ghostmail-worker.your-subdomain.workers.dev`

## Step 7: Set Telegram Webhook

Replace `YOUR_WORKER_URL` with your Cloudflare Worker URL:

```bash
curl -F "url=https://ghostmail-worker.your-subdomain.workers.dev" \
     https://api.telegram.org/bot8473632705:AAERjB2sxFxD_oc7U4GjQbxsCtDT3E1feIk/setWebhook
```

## Step 8: Test Your Bot

1. Go to https://t.me/ghostmailo_bot
2. Send `/start`
3. Your bot should respond instantly!

## Step 9: Monitor and Debug

View logs:
```bash
wrangler tail
```

Check webhook status:
```bash
curl https://api.telegram.org/bot8473632705:AAERjB2sxFxD_oc7U4GjQbxsCtDT3E1feIk/getWebhookInfo
```

## Advanced: Using Cloudflare KV for Persistent Storage

For production, use Cloudflare KV to store user sessions:

```bash
wrangler kv:namespace create "SESSIONS"
```

Add to `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "your-kv-namespace-id"
```

## Troubleshooting

### Bot not responding?
1. Check webhook is set correctly
2. View logs with `wrangler tail`
3. Ensure environment variables are set

### API errors?
1. Verify ghostmail.one API key is valid
2. Check API endpoint URLs
3. Monitor rate limits

### Deployment issues?
1. Ensure you're logged into Cloudflare
2. Check `wrangler.toml` configuration
3. Verify TypeScript compilation

## Benefits of Cloudflare Workers

- **Free**: 100,000 requests/day
- **Fast**: Global edge locations
- **Reliable**: 99.9% uptime
- **Scalable**: Auto-scaling
- **Secure**: Built-in DDoS protection

Your GhostMail bot is now hosted 24/7 on Cloudflare's global network! 🚀

## Cost Estimate

- **Free tier**: 100,000 requests/day
- **Paid tier**: $5/month for 10 million requests
- **KV storage**: $0.50/month per million operations

Most personal bots will run completely free on Cloudflare Workers!