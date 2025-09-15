# GhostMail Telegram Bot

A Telegram bot that provides temporary email services using the ghostmail.one API. Create disposable email addresses for privacy and security.

## Features

- 📧 Create temporary email addresses
- 📥 Check inbox for received messages
- 🌐 View available domains
- 🗑️ Delete emails when done
- 🔒 Privacy-focused (emails auto-delete)
- 💻 Interactive inline keyboards
- ⚡ Real-time message checking

## Setup Instructions

### 1. Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### 2. Installation

1. Clone or download this project
2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env

```

### 3. Running the Bot

```bash
npm start
```

Or for development:
```bash
node index.js
```

## Bot Commands

- `/start` - Welcome message and main menu
- `/create` - Create a new temporary email
- `/messages` - Check your inbox
- `/domains` - View available domains  
- `/delete` - Delete current email
- `/help` - Show help information

## API Integration

The bot integrates with ghostmail.one API endpoints:

- `GET /api/domains/{apikey}` - List available domains
- `POST /api/email/create/{apikey}` - Create new email
- `GET /api/messages/{email_token}/{apikey}` - Fetch messages
- `POST /api/email/delete/{email_token}/{apikey}` - Delete email

## Usage Flow

1. Start the bot with `/start`
2. Create a temporary email with `/create`
3. Use the email for registrations/services
4. Check messages with `/messages`
5. Delete email with `/delete` when done

## Security Features

- Emails automatically expire after set time
- No permanent storage of user data
- Session-based email management
- Secure API key handling

## Bot Information

- **Bot Username**: @ghostmailo_bot
- **Bot URL**: https://t.me/ghostmailo_bot

## Development

The bot is built with:
- `node-telegram-bot-api` - Telegram Bot API wrapper
- `axios` - HTTP client for API calls
- `dotenv` - Environment variable management

## Error Handling

The bot includes comprehensive error handling for:
- API failures
- Network issues
- Invalid user sessions
- Missing environment variables

## License

This project is open source and available under the ISC License.
