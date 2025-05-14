![Alt text](https://github.com/xdityagr/DiscordVoiceDetection/blob/main/src/dcaud_banner.png?raw=true "Banner Image")

# DCAUD: Discord Audio Detection Bot

**Version**: 1.0.0
**Author**: Aditya Gaur  
**License**: MIT  

## Overview
DCAUD is a specialized utility that monitors voice channels to detect speech from a specified user using Cobra Voice Activity Detection (VAD) technology from Picovoice. 
It provides real-time speech detection notifications via an HTTP API, making it suitable for applications requiring voice activity monitoring in Discord voice channels.

### Features

- **Single-User Speech Detection**: Monitors a designated user's voice activity in a Discord voice channel.
- **Real-Time VAD**: Leverages Cobra VAD for accurate, low-latency speech detection.
- **HTTP API Integration**: Sends speaking status updates to external applications via HTTP POST requests.
- **Audio Gain Adjustment**: Amplifies quieter voices for improved detection.
- **Robust Connection Management**: Ensures reliable voice channel connections and resource cleanup.
- **Customizable Parameters**: Configurable settings for silence detection, voice probability thresholds, and more.

## Prerequisites

Before setting up DCAUD, ensure you have the following:

- **Node.js**: Version 16.17.0 or higher (Node.js 18 recommended for executable builds). Download from [Node.js](https://nodejs.org/en/download/).
- **System Dependencies**:
  - **Windows**: Microsoft Visual C++ Redistributable (x64). Download from [Microsoft](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).
  - **FFmpeg**: Required for audio processing. Bundled via `ffmpeg-static`, but you can install it manually from [FFmpeg](https://ffmpeg.org/download.html#build-windows) if needed.
- **Discord Bot Token**: Required to authenticate the bot with Discord.
- **Picovoice Access Key**: Required for Cobra VAD functionality.
- **Git**: Optional, for cloning the repository. Download from [Git](https://git-scm.com/downloads).

## Creating a Discord Bot and Obtaining a Token

To use DCAUD, you need a Discord bot with appropriate permissions and a bot token. Follow these steps:

1. **Create a Discord Application**:
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications).
   - Click **New Application**, enter a name (e.g., "DCAUD Bot"), and click **Create**.
   - Navigate to the **Bot** tab in the left sidebar and click **Add Bot**. Confirm by clicking **Yes, do it!**.

2. **Configure Bot Permissions**:
   - In the **Bot** tab, enable the following **Privileged Gateway Intents**:
     - **Presence Intent**
     - **Server Members Intent**
     - **Message Content Intent**
   - Under **Bot Permissions**, select:
     - `View Channels`
     - `Connect`
     - `Speak`
     - (Optional) `Send Messages` (for responding to `!join` and `!leave` commands).

3. **Obtain the Bot Token**:
   - In the **Bot** tab, click **Reset Token** (or **Copy** if already visible) to get the bot token.
   - **Important**: Keep the token secure and never share it publicly.
   - Copy the token for use in the `.env` file (see [Setup](#setup)).

4. **Invite the Bot to Your Server**:
   - Go to the **OAuth2** > **URL Generator** tab in the Developer Portal.
   - In **Scopes**, select `bot` and `applications.commands`.
   - In **Bot Permissions**, select the permissions listed above.
   - Copy the generated URL, paste it into a browser, and follow the prompts to invite the bot to your Discord server.

## Obtaining a Picovoice Access Key

To use Cobra VAD, you need a Picovoice access key. Follow these steps:

1. **Sign Up for Picovoice Console**:
   - Visit the [Picovoice Console](https://console.picovoice.ai/).
   - Sign up for a free account or log in if you already have one.

2. **Generate an Access Key**:
   - In the Picovoice Console, navigate to the **AccessKey** section.
   - Click **Generate AccessKey** to create a new key.
   - Copy the key for use in the `.env` file (see [Setup](#setup)).

3. **Verify Access Key**:
   - Ensure the key is valid for the Cobra VAD SDK. If you encounter errors (e.g., `00000136`), contact Picovoice support via the Console.

## Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/xdityagr/DiscordVoiceDetection
   cd src
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Create a `.env` File**:
   In the project root, create a file named `.env` with the following content:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   COBRA_ACCESS_KEY=your_picovoice_access_key
   TARGET_USERNAME=your_target_discord_username
   DEBUG=true # Optional, enables verbose logging
   ```
   Replace `your_discord_bot_token`, `your_picovoice_access_key`, and `your_target_discord_username` with the appropriate values.

## Running the Bot

Run the bot using Node.js:
```bash
node DCAudioDetection.js --username <TARGET_USERNAME>
```

Alternatively, specify the username in the `.env` file to omit the `--username` flag.

## Executable HTTP Client Installation

To install the standalone executable for Windows x64:
1. You can navigate to releases to download it
2. Make sure '.env' exists with required params in the same directory as the executable.

## Built the executable yourself

1. **Install `pkg`** (Make sure your Node.js version is 18.15.0):
   ```bash
   npm install pkg --save-dev
   ```

2. **Build the Executable**:
   ```bash
   npm run build
   ```
   This generates `dist/DCAUD.exe`.

3. **Run the Executable**:
   ```bash
   cd dist
   ./DCAUD.exe --username <TARGET_USERNAME>
   ```

## Usage

1. **Join a Voice Channel**: The target user (specified by `TARGET_USERNAME`) must be in a Discord voice channel.
2. **Send Commands**:
   - `!join`: Connects the bot to the voice channel and starts monitoring the target user.
   - `!leave`: Disconnects the bot and cleans up resources.
3. **Monitor HTTP API**:
   The bot sends POST requests to `http://localhost:3000/speaking` with JSON payloads:
   ```json
   {
     "username": "<TARGET_USERNAME>",
     "speaking": true
   }
   ```
   Use a tool like [Postman](https://www.postman.com/) or a custom server to receive these notifications.

## Dependencies

- `discord.js`: ^14.19.3
- `@discordjs/voice`: ^0.18.0
- `@discordjs/opus`: ^0.10.0
- `@picovoice/cobra-node`: ^2.0.4
- `express`: ^5.1.0
- `prism-media`: ^1.3.5
- `ffmpeg-static`: ^5.2.0
- `dotenv`: ^16.4.5
- `minimist`: Latest
- (See `package.json` for the full list)

## Troubleshooting

- **"Cannot find module" for `@discordjs/opus`**:
  - Ensure `opus.node` is in `dist/bindings/` and matches Node.js 18 (Windows x64).
  - Verify `node_modules/@discordjs/opus/package.json` is included in the `pkg` configuration.
- **Picovoice Error `00000136`**:
  - Ensure `pv_cobra.node` is compatible with Node.js 18 and Windows x64.
  - Install Microsoft Visual C++ Redistributable (x64).
  - Verify the `COBRA_ACCESS_KEY` is valid.
  - Picovoice Cobra key is valid for 1 system only, so if used once on a system, It cannot be reused on another system. If that happens, It raises `Error (0000136)`
- **FFmpeg Errors**:
  - Ensure `ffmpeg-static` is bundled or install FFmpeg manually and add it to the system PATH.
- **Bot Fails to Join Voice Channel**:
  - Check that the bot has `Connect` and `Speak` permissions in the Discord server.
  - Ensure the target user is in a voice channel when using `!join`.

For additional help, open an issue on the [GitHub repository](https://github.com/xdityagr/DiscordVoiceDetection) or contact Picovoice support for Cobra-specific issues.

## Contributing

Contributions are welcome! Please submit issues or pull requests to the GitHub repository. For major changes, open an issue to discuss first.

### Made in India with <3
