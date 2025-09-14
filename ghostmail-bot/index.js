const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

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

// Utility function to truncate text with proper word boundaries
function truncateText(text, maxLength = 200) {
    if (!text || text.length <= maxLength) return text;
    
    // Find the last space within the limit
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    // If we find a space, cut there, otherwise use the full truncated length
    const cutPoint = lastSpace > maxLength * 0.8 ? lastSpace : maxLength;
    
    return text.substring(0, cutPoint) + '...';
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

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const API_KEY = process.env.GHOSTMAIL_API_KEY;
const BASE_URL = process.env.GHOSTMAIL_BASE_URL;

// Store user sessions
const userSessions = new Map();

// Ghostmail API functions
class GhostmailAPI {
    static async getDomains() {
        try {
            const response = await axios.get(`${BASE_URL}/domains/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching domains:', error.message);
            return null;
        }
    }

    static async createEmail() {
        try {
            const response = await axios.post(`${BASE_URL}/email/create/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error creating email:', error.message);
            return null;
        }
    }

    static async changeEmail(emailToken, username, domain) {
        try {
            const response = await axios.post(`${BASE_URL}/email/change/${emailToken}/${username}/${domain}/${API_KEY}`);
            return response.data;
        } catch (error) {
            console.error('Error changing email:', error.message);
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

// Bot commands
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🔒 **Welcome to GhostMail Bot!**

I can help you create temporary email addresses for privacy and security.

**Available Commands:**
/create - Create a new temporary email
/messages - Check your inbox
/domains - View available domains
/custom - Create custom email
/delete - Delete current email
/help - Show this help message

Your temporary emails are automatically deleted after a certain time period to protect your privacy.

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

    bot.sendMessage(chatId, welcomeMessage, options);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
🔒 **GhostMail Bot Help**

**Commands:**
/start - Welcome message and main menu
/create - Create a new temporary email
/messages - Check your inbox
/domains - View available domains
/delete - Delete current email and create new one
/help - Show this help

**How it works:**
1. Use /create to generate a temporary email
2. Use the email for registrations or services
3. Use /messages to check received emails
4. Emails auto-delete after expiration time

**Privacy:** All temporary emails are automatically deleted to protect your privacy.

Need more help? Just type any command to get started! 🚀`;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/create/, async (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, '⏳ Creating your temporary email...');
    
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

You can now use this email for registrations. Use /messages to check your inbox.`;

        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Check Messages', callback_data: 'check_messages' }],
                    [{ text: '🔄 Create New', callback_data: 'create_email' }, { text: '🗑️ Delete', callback_data: 'delete_email' }]
                ]
            }
        };
        
        bot.sendMessage(chatId, message, options);
    } else {
        bot.sendMessage(chatId, '❌ Failed to create email. Please try again.');
    }
});

bot.onText(/\/messages/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    
    if (!session) {
        bot.sendMessage(chatId, '❌ No active email session. Use /create to create an email first.');
        return;
    }
    
    bot.sendMessage(chatId, '📬 Checking your messages...');
    
    const result = await GhostmailAPI.getMessages(session.token);
    
    if (result && result.status === 'success') {
        const messages = result.data.messages;
        
        if (messages.length === 0) {
            bot.sendMessage(chatId, `📭 No messages found in ${session.email}\n\nYour inbox is currently empty.`);
            return;
        }
        
        let messageText = `📬 **Inbox for ${session.email}**\n\n`;
        
        // If too many messages, show only recent ones and provide navigation
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
        
        // Add summary if there are more messages
        if (totalMessages > maxMessagesPerPage) {
            messageText += `📬 You have ${totalMessages - maxMessagesPerPage} more messages. Use the refresh button to see updates.`;
        }
        
        // Create simple keyboard with standard options
        const keyboard = [
            [{ text: '🔄 Refresh', callback_data: 'check_messages' }],
            [{ text: '📧 New Email', callback_data: 'create_email' }]
        ];
        
        // Add delete buttons for individual messages if there are messages to delete
        if (messagesToShow.length > 0 && messagesToShow.length <= 3) {
            const deleteButtons = [];
            messagesToShow.forEach((message, index) => {
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
                await bot.sendMessage(chatId, chunk, chunkOptions);
                // Add small delay between chunks to avoid hitting rate limits
                if (i < messageChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error('Error sending message chunk:', error);
                // If markdown fails, try without formatting and clean special characters
                try {
                    const plainChunk = chunk
                        .replace(/\*\*/g, '') // Remove bold
                        .replace(/`/g, '') // Remove code
                        .replace(/\\([_*[\]()~`>#+=|{}.!\\\\])/g, '$1') // Unescape
                        .replace(/[^\x20-\x7E\n\r\t]/g, ''); // Keep only basic ASCII + newlines/tabs
                    
                    await bot.sendMessage(chatId, plainChunk, 
                        i === messageChunks.length - 1 ? { reply_markup: options.reply_markup } : {});
                } catch (secondError) {
                    console.error('Failed to send even plain text:', secondError);
                    // Last resort: send error message
                    if (i === messageChunks.length - 1) {
                        await bot.sendMessage(chatId, '❌ Error displaying message content. The message may contain unsupported characters.', 
                            { reply_markup: options.reply_markup });
                    }
                }
            }
        }
    } else {
        bot.sendMessage(chatId, '❌ Failed to fetch messages. Please try again.');
    }
});

bot.onText(/\/domains/, async (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, '🌐 Fetching available domains...');
    
    const result = await GhostmailAPI.getDomains();
    
    if (result && result.status === 'success') {
        const domains = result.data.domains;
        let domainText = '🌐 **Available Domains:**\n\n';
        
        Object.values(domains).forEach((domain, index) => {
            domainText += `${index + 1}. ${domain}\n`;
        });
        
        domainText += '\nUse /custom to create a custom email with your preferred domain.';
        
        bot.sendMessage(chatId, domainText, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, '❌ Failed to fetch domains. Please try again.');
    }
});

bot.onText(/\/delete/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    
    if (!session) {
        bot.sendMessage(chatId, '❌ No active email session to delete.');
        return;
    }
    
    bot.sendMessage(chatId, '🗑️ Deleting your current email...');
    
    const result = await GhostmailAPI.deleteEmail(session.token);
    
    if (result && result.status === 'success') {
        userSessions.delete(chatId);
        
        const message = `✅ **Email Deleted Successfully!**

Your previous email has been deleted. Use /create to generate a new temporary email.`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📧 Create New Email', callback_data: 'create_email' }]
                ]
            }
        };
        
        bot.sendMessage(chatId, message, options);
    } else {
        bot.sendMessage(chatId, '❌ Failed to delete email. Please try again.');
    }
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message.chat.id;
    
    // Answer the callback query
    bot.answerCallbackQuery(callbackQuery.id);
    
    switch (data) {
        case 'create_email':
            bot.sendMessage(chatId, '⏳ Creating your temporary email...');
            
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
                
                bot.sendMessage(chatId, message, options);
            } else {
                bot.sendMessage(chatId, '❌ Failed to create email. Please try again.');
            }
            break;
            
        case 'check_messages':
            const session = userSessions.get(chatId);
            
            if (!session) {
                bot.sendMessage(chatId, '❌ No active email session. Create an email first.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📧 Create Email', callback_data: 'create_email' }]
                        ]
                    }
                });
                return;
            }
            
            bot.sendMessage(chatId, '📬 Checking your messages...');
            
            const messagesResult = await GhostmailAPI.getMessages(session.token);
            
            if (messagesResult && messagesResult.status === 'success') {
                const messages = messagesResult.data.messages;
                
                if (messages.length === 0) {
                    bot.sendMessage(chatId, `📭 No messages found in ${session.email}\n\nYour inbox is currently empty.`);
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
                    const deleteButtons = [];
                    messagesToShow.forEach((message, index) => {
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
                        await bot.sendMessage(chatId, chunk, chunkOptions);
                        // Add small delay between chunks
                        if (i < messageChunks.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    } catch (error) {
                        console.error('Error sending message chunk:', error);
                        // If markdown fails, try without formatting
                        if (error.description && error.description.includes('parse')) {
                            await bot.sendMessage(chatId, chunk.replace(/\*\*/g, '').replace(/`/g, ''), 
                                i === messageChunks.length - 1 ? { reply_markup: options.reply_markup } : {});
                        }
                    }
                }
            } else {
                bot.sendMessage(chatId, '❌ Failed to fetch messages. Please try again.');
            }
            break;
            
        case 'view_domains':
            const domainsResult = await GhostmailAPI.getDomains();
            
            if (domainsResult && domainsResult.status === 'success') {
                const domains = domainsResult.data.domains;
                let domainText = '🌐 **Available Domains:**\n\n';
                
                Object.values(domains).forEach((domain, index) => {
                    domainText += `${index + 1}. ${domain}\n`;
                });
                
                domainText += '\nUse /create to create a new email .';
                
                bot.sendMessage(chatId, domainText, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, '❌ Failed to fetch domains. Please try again.');
            }
            break;
            
        case 'delete_email':
            const deleteSession = userSessions.get(chatId);
            
            if (!deleteSession) {
                bot.sendMessage(chatId, '❌ No active email session to delete.');
                return;
            }
            
            bot.sendMessage(chatId, '🗑️ Deleting your current email...');
            
            const deleteResult = await GhostmailAPI.deleteEmail(deleteSession.token);
            
            if (deleteResult && deleteResult.status === 'success') {
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
                
                bot.sendMessage(chatId, message, options);
            } else {
                bot.sendMessage(chatId, '❌ Failed to delete email. Please try again.');
            }
            break;
            
        default:
            // Handle view_message_ callbacks
            if (data.startsWith('view_message_')) {
                const messageId = data.replace('view_message_', '');
                const session = userSessions.get(chatId);
                
                if (!session) {
                    bot.sendMessage(chatId, '❌ No active email session.');
                    return;
                }
                
                bot.sendMessage(chatId, '📖 Loading full message...');
                
                const messageResult = await GhostmailAPI.getMessage(messageId);
                
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
                        fullMessage.attachments.forEach((attachment, index) => {
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
                            await bot.sendMessage(chatId, chunk, chunkOptions);
                            if (i < messageChunks.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        } catch (error) {
                            console.error('Error sending full message chunk:', error);
                            try {
                                const plainChunk = chunk
                                    .replace(/\*\*/g, '') // Remove bold
                                    .replace(/`/g, '') // Remove code
                                    .replace(/\\([_*[\]()~`>#+=|{}.!\\])/g, '$1') // Unescape
                                    .replace(/[^\x20-\x7E\n\r\t]/g, ''); // Keep only basic ASCII
                                
                                await bot.sendMessage(chatId, plainChunk, 
                                    i === messageChunks.length - 1 ? { reply_markup: backOptions.reply_markup } : {});
                            } catch (secondError) {
                                console.error('Failed to send plain full message:', secondError);
                                if (i === messageChunks.length - 1) {
                                    await bot.sendMessage(chatId, '❌ Error displaying full message content.',
                                        { reply_markup: backOptions.reply_markup });
                                }
                            }
                        }
                    }
                } else {
                    bot.sendMessage(chatId, '❌ Failed to load full message. It may have been deleted.');
                }
            }
            // Handle delete_msg_ callbacks
            else if (data.startsWith('delete_msg_')) {
                const messageId = data.replace('delete_msg_', '');
                
                bot.sendMessage(chatId, '🗑️ Deleting message...');
                
                const deleteResult = await GhostmailAPI.deleteMessage(messageId);
                
                if (deleteResult && deleteResult.status === 'success') {
                    bot.sendMessage(chatId, '✅ Message deleted successfully!', {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ Back to Inbox', callback_data: 'check_messages' }]
                            ]
                        }
                    });
                } else {
                    bot.sendMessage(chatId, '❌ Failed to delete message.');
                }
            }
            break;
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🚀 GhostMail Bot is running...');