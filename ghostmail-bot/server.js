const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Bot setup
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);
const API_KEY = process.env.GHOSTMAIL_API_KEY;
const BASE_URL = process.env.GHOSTMAIL_BASE_URL || 'https://ghostmail.one/api';

// Debug environment variables
console.log('🔧 Environment Variables:');
console.log('📱 BOT_TOKEN:', token ? 'Set (length: ' + token.length + ')' : 'NOT SET');
console.log('🔑 GHOSTMAIL_API_KEY:', API_KEY ? 'Set (length: ' + API_KEY.length + ')' : 'NOT SET');
console.log('🌐 GHOSTMAIL_BASE_URL:', BASE_URL);
console.log('🖥️  RENDER_EXTERNAL_URL:', process.env.RENDER_EXTERNAL_URL || 'NOT SET');

// Store user sessions (in production, consider using a database)
const userSessions = new Map();

// Utility function to strip HTML tags and format text safely for Telegram
function stripHtmlAndFormat(html) {
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

// Function to split long messages into chunks
function splitMessage(text, maxLength = 4000) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
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

// Ghostmail API functions
class GhostmailAPI {
    static async getDomains() {
        try {
            console.log(`🔍 Making domains request to: ${BASE_URL}/domains/${API_KEY}`);
            const response = await axios.get(`${BASE_URL}/domains/${API_KEY}`);
            console.log('✅ Domains response:', response.status, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Error fetching domains:', error.message);
            console.error('📊 Response status:', error.response?.status);
            console.error('📄 Response data:', error.response?.data);
            console.error('🔗 Request URL:', `${BASE_URL}/domains/${API_KEY}`);
            return null;
        }
    }

    static async createEmail() {
        try {
            console.log(`🔍 Making create email request to: ${BASE_URL}/email/create/${API_KEY}`);
            const response = await axios.post(`${BASE_URL}/email/create/${API_KEY}`);
            console.log('✅ Create email response:', response.status, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Error creating email:', error.message);
            console.error('📊 Response status:', error.response?.status);
            console.error('📄 Response data:', error.response?.data);
            console.error('🔗 Request URL:', `${BASE_URL}/email/create/${API_KEY}`);
            return null;
        }
    }

    static async deleteEmail(emailToken) {
        try {
            const response = await axios.post(`${BASE_URL}/email/delete/${emailToken}/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error deleting email:', error.message);
            return null;
        }
    }

    static async getMessages(emailToken) {
        try {
            const response = await axios.get(`${BASE_URL}/messages/${emailToken}/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching messages:', error.message);
            return null;
        }
    }

    static async getMessage(messageId) {
        try {
            const response = await axios.get(`${BASE_URL}/message/${messageId}/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching message:', error.message);
            return null;
        }
    }

    static async deleteMessage(messageId) {
        try {
            const response = await axios.post(`${BASE_URL}/message/delete/${messageId}/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error deleting message:', error.message);
            return null;
        }
    }
}

// Bot command handlers
async function handleStart(chatId) {
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

    await bot.sendMessage(chatId, welcomeMessage, options);
}

async function handleCreateEmail(chatId) {
    await bot.sendMessage(chatId, '⏳ Creating your temporary email...');
    
    const result = await GhostmailAPI.createEmail();
    
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
        
        await bot.sendMessage(chatId, message, options);
    } else {
        await bot.sendMessage(chatId, '❌ Failed to create email. Please try again.');
    }
}

async function handleCheckMessages(chatId) {
    const session = userSessions.get(chatId);
    
    if (!session) {
        await bot.sendMessage(chatId, '❌ No active email session. Create an email first.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📧 Create Email', callback_data: 'create_email' }]
                ]
            }
        });
        return;
    }
    
    await bot.sendMessage(chatId, '📬 Checking your messages...');
    
    const result = await GhostmailAPI.getMessages(session.token);
    
    if (result && result.status === 'success') {
        const messages = result.data.messages;
        
        if (messages.length === 0) {
            await bot.sendMessage(chatId, `📭 No messages found in ${session.email}\n\nYour inbox is currently empty.`);
            return;
        }
        
        let messageText = `📬 **Inbox for ${session.email}**\n\n`;
        
        const maxMessagesPerPage = 5;
        const totalMessages = messages.length;
        const messagesToShow = messages.slice(0, maxMessagesPerPage);
        
        if (totalMessages > maxMessagesPerPage) {
            messageText += `📊 Showing ${maxMessagesPerPage} of ${totalMessages} messages\n\n`;
        }
        
        messagesToShow.forEach((message, index) => {
            const readStatus = message.is_seen ? '✅' : '🔵';
            const cleanContent = stripHtmlAndFormat(message.content);
            
            messageText += `${readStatus} **Message ${index + 1}**\n`;
            messageText += `👤 **From:** ${message.from}\n`;
            messageText += `📧 **Email:** ${message.from_email}\n`;
            messageText += `📄 **Subject:** ${message.subject || 'No Subject'}\n`;
            messageText += `📅 **Received:** ${message.receivedAt}\n`;
            
            if (message.attachments && message.attachments.length > 0) {
                messageText += `📎 **Attachments:** ${message.attachments.length} file(s)\n`;
                message.attachments.forEach((attachment, attIndex) => {
                    messageText += `   ${attIndex + 1}. ${attachment.file}\n`;
                });
            }
            
            messageText += `\n💌 **Full Content:**\n${cleanContent}\n`;
            messageText += `━━━━━━━━━━━━━━━\n\n`;
        });
        
        if (totalMessages > maxMessagesPerPage) {
            messageText += `📬 You have ${totalMessages - maxMessagesPerPage} more messages.`;
        }
        
        const keyboard = [
            [{ text: '🔄 Refresh', callback_data: 'check_messages' }],
            [{ text: '📧 New Email', callback_data: 'create_email' }]
        ];
        
        if (messagesToShow.length > 0 && messagesToShow.length <= 3) {
            const deleteButtons = [];
            messagesToShow.forEach((message, index) => {
                deleteButtons.push({ 
                    text: `🗑️ Delete Msg ${index + 1}`, 
                    callback_data: `delete_msg_${message.id}` 
                });
            });
            
            for (let i = 0; i < deleteButtons.length; i += 2) {
                const row = deleteButtons.slice(i, i + 2);
                keyboard.splice(-1, 0, row);
            }
        }
        
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        };
        
        const messageChunks = splitMessage(messageText);
        
        for (let i = 0; i < messageChunks.length; i++) {
            const chunk = messageChunks[i];
            const chunkOptions = i === messageChunks.length - 1 ? options : { parse_mode: 'Markdown' };
            
            try {
                await bot.sendMessage(chatId, chunk, chunkOptions);
                if (i < messageChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error('Error sending message chunk:', error);
                try {
                    const plainChunk = chunk
                        .replace(/\*\*/g, '')
                        .replace(/`/g, '')
                        .replace(/\\([_*[\]()~`>#+=|{}.!\\])/g, '$1')
                        .replace(/[^\x20-\x7E\n\r\t]/g, '');
                    
                    await bot.sendMessage(chatId, plainChunk, 
                        i === messageChunks.length - 1 ? { reply_markup: options.reply_markup } : {});
                } catch (secondError) {
                    console.error('Failed to send plain message:', secondError);
                    if (i === messageChunks.length - 1) {
                        await bot.sendMessage(chatId, '❌ Error displaying message content.', 
                            { reply_markup: options.reply_markup });
                    }
                }
            }
        }
    } else {
        await bot.sendMessage(chatId, '❌ Failed to fetch messages. Please try again.');
    }
}

async function handleViewDomains(chatId) {
    const result = await GhostmailAPI.getDomains();
    
    if (result && result.status === 'success') {
        const domains = result.data.domains;
        let domainText = '🌐 **Available Domains:**\n\n';
        
        Object.values(domains).forEach((domain, index) => {
            domainText += `${index + 1}. ${domain}\n`;
        });
        
        await bot.sendMessage(chatId, domainText, { parse_mode: 'Markdown' });
    } else {
        await bot.sendMessage(chatId, '❌ Failed to fetch domains. Please try again.');
    }
}

async function handleDeleteEmail(chatId) {
    const session = userSessions.get(chatId);
    
    if (!session) {
        await bot.sendMessage(chatId, '❌ No active email session to delete.');
        return;
    }
    
    await bot.sendMessage(chatId, '🗑️ Deleting your current email...');
    
    const result = await GhostmailAPI.deleteEmail(session.token);
    
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
        
        await bot.sendMessage(chatId, message, options);
    } else {
        await bot.sendMessage(chatId, '❌ Failed to delete email. Please try again.');
    }
}

async function handleDeleteMessage(chatId, messageId) {
    await bot.sendMessage(chatId, '🗑️ Deleting message...');
    
    const deleteResult = await GhostmailAPI.deleteMessage(messageId);
    
    if (deleteResult && deleteResult.status === 'success') {
        await bot.sendMessage(chatId, '✅ Message deleted successfully!', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ Back to Inbox', callback_data: 'check_messages' }]
                ]
            }
        });
    } else {
        await bot.sendMessage(chatId, '❌ Failed to delete message.');
    }
}

// Webhook endpoint
app.post(`/webhook/${token}`, async (req, res) => {
    const update = req.body;
    
    try {
        // Handle regular messages
        if (update.message) {
            const message = update.message;
            const chatId = message.chat.id;
            const text = message.text;

            if (text === '/start' || text === '/help') {
                await handleStart(chatId);
            } else if (text === '/create') {
                await handleCreateEmail(chatId);
            } else if (text === '/messages') {
                await handleCheckMessages(chatId);
            } else if (text === '/domains') {
                await handleViewDomains(chatId);
            } else if (text === '/delete') {
                await handleDeleteEmail(chatId);
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
                    await handleCreateEmail(chatId);
                    break;
                case 'check_messages':
                    await handleCheckMessages(chatId);
                    break;
                case 'view_domains':
                    await handleViewDomains(chatId);
                    break;
                case 'delete_email':
                    await handleDeleteEmail(chatId);
                    break;
                default:
                    if (data.startsWith('delete_msg_')) {
                        const messageId = data.replace('delete_msg_', '');
                        await handleDeleteMessage(chatId, messageId);
                    }
                    break;
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing update:', error);
        res.status(200).send('Error');
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('GhostMail Bot is running!');
});

// Health check for render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 GhostMail Bot server is running on port ${PORT}`);
    
    // Set webhook URL for Render
    if (process.env.RENDER_EXTERNAL_URL) {
        const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook/${token}`;
        bot.setWebHook(webhookUrl).then(() => {
            console.log(`✅ Webhook set to: ${webhookUrl}`);
        }).catch((error) => {
            console.error('❌ Failed to set webhook:', error);
        });
    } else {
        // For local development or if RENDER_EXTERNAL_URL is not set
        console.log('⚠️ RENDER_EXTERNAL_URL not set, webhook not configured');
    }
});