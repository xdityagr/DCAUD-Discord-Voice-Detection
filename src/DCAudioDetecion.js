/**
 * ============================================================================
 *                      DCAUD : Discord Audio Detection Bot
 * ============================================================================
 * 
 * @description   A specialized Discord bot that monitors voice channels and 
 *                detects speech from a target user using Cobra VAD AI.
 *                Provides real-time speech detection notifications via HTTP API.
 * 
 * @version       1.2.0
 * @author        Aditya Gaur
 * @date          May 11, 2025
 * 
 * @features      - Single-user voice activity detection
 *                - Real-time speech detection with Cobra VAD
 *                - HTTP API for external integrations
 *                - Audio gain adjustment for quieter speakers
 * 
 * @dependencies  - discord.js
 *                - @discordjs/voice
 *                - @discordjs/opus
 *                - express
 *                - prism-media
 *                - @picovoice/cobra-node
 *                - minimist
 *                - dotenv
 * 
 * @usage         1. Set up .env with DISCORD_TOKEN for the discord bot and COBRA_ACCESS_KEY
 *                2. Run with: node DCAudioDetection.js --username <TARGET_USERNAME>
 *                3. Use !join in Discord to connect to a voice channel
 *                4. Use !leave to disconnect from a voice channel
 * 
 * @license       MIT
 * ============================================================================
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

require('@discordjs/opus'); 

const express = require('express');
const prism = require('prism-media');
const http = require('http');

const { EventEmitter } = require('events');
const { Cobra } = require('@picovoice/cobra-node');

const minimist = require('minimist');
require('dotenv').config();

const nodeVersion = process.version.match(/^v(\d+\.\d+)/)[1];
if (parseFloat(nodeVersion) < 16.17) {
  console.error('[ERROR] Node.js version 16.17.0 or higher is required. Current version:', process.version);
  process.exit(1);
}

// Increase event emitter limit to prevent warnings
EventEmitter.defaultMaxListeners = 20;

// Parse cmd args or env vars passed
const args = minimist(process.argv.slice(2));
const TARGET_USERNAME = args.username || process.env.TARGET_USERNAME;
const DEBUG = args.debug || process.env.DEBUG === 'true';

// Validate env vars
if (!TARGET_USERNAME) {
  console.error('[ERROR] No username provided. Use --username <username> or set TARGET_USERNAME env variable.');
  process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
  console.error('[ERROR] DISCORD_TOKEN is not set in .env file.');
  process.exit(1);
}
if (!process.env.COBRA_ACCESS_KEY) {
  console.error('[ERROR] COBRA_ACCESS_KEY is not set in .env file.');
  process.exit(1);
}

// Initialize Cobra with retry logic
let tempCobra;
const MAX_COBRA_INIT_RETRIES = 3;
let cobraInitAttempts = 0;

async function initializeCobra() {
  while (cobraInitAttempts < MAX_COBRA_INIT_RETRIES) {
    try {
      tempCobra = new Cobra(process.env.COBRA_ACCESS_KEY);
      console.log('[INFO] Successfully initialized Cobra VAD');
      return true;
    } catch (e) {
      cobraInitAttempts++;
      console.error(`[ERROR] Failed to initialize Cobra (attempt ${cobraInitAttempts}/${MAX_COBRA_INIT_RETRIES}):`, e.message);
      if (cobraInitAttempts === MAX_COBRA_INIT_RETRIES) {
        console.error('[ERROR] Max retries reached for Cobra initialization. Exiting.');
        process.exit(1);
      }
      // Wait 2 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
}

// Initialize Cobra
(async () => {
  await initializeCobra();
  const COBRA_FRAME_LENGTH = tempCobra.frameLength; // 512
  tempCobra.release();

  const CONFIG = {
    SILENCE_TIMEOUT: 150, // ms
    VOICE_PROBABILITY_THRESHOLD: 0.35, // Decrease for quieter voices, Increase for more accuracy.
    SILENCE_DETECTION_TIMEOUT: 150, // ms
    HTTP_PORT: 3000,
    FRAME_SIZE: COBRA_FRAME_LENGTH, // 512
    MAX_SPEAKING_DURATION: 30000, // 30s
    MIN_SILENT_FRAMES: 3,
    GAIN: 3.0, // Audio amplification
    STREAM_TIMEOUT: 10000, // 10s
    INACTIVITY_TIMEOUT: 2000, // 2s timeout for no audio data
    VOICE_PROB_SUMMARY_INTERVAL: 1000, // Debug voiceProb summary every 1s
    CLEANUP_TIMEOUT: 5000, // 5s timeout for cleanup
    CLEANUP_RETRY_DELAY: 500, // ms delay between retries
    MAX_IGNORED_SPEAKING_EVENTS: 3, // Max number of ignored speaking events before forcing cleanup
    IGNORED_EVENT_WINDOW: 5000 // 5s window to track ignored speaking events
  };

  // Validate FRAME_SIZE
  if (CONFIG.FRAME_SIZE !== COBRA_FRAME_LENGTH) {
    console.warn(`[WARN] FRAME_SIZE (${CONFIG.FRAME_SIZE}) does not match Cobra.frameLength (${COBRA_FRAME_LENGTH}). Using ${COBRA_FRAME_LENGTH}.`);
    CONFIG.FRAME_SIZE = COBRA_FRAME_LENGTH;
  }

  // Set up HTTP server
  const app = express();
  app.use(express.json());
  app.post('/speaking', (req, res) => {
    const { username, speaking } = req.body;
    console.log(`[INFO] ${username} ${speaking ? 'started' : 'stopped'} speaking`);
    res.sendStatus(200);
  });

  let server;
  function startHttpServer(port) {
    return new Promise((resolve, reject) => {
      server = app.listen(port, () => {
        console.log(`[INFO] HTTP server listening on port ${port}`);
        resolve();
      }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[WARN] Port ${port} is in use, trying port ${port + 1}`);
          startHttpServer(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  try {
    await startHttpServer(CONFIG.HTTP_PORT);
  } catch (err) {
    console.error('[ERROR] Failed to start HTTP server:', err.message);
    process.exit(1);
  }

  // Initialize Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.once('ready', () => console.log(`[INFO] Logged in as ${client.user.tag}`));

  // Report speaking status via HTTP
  function reportSpeaking(username, speaking) {
    const postData = JSON.stringify({ username, speaking });
    const options = {
      hostname: 'localhost',
      port: server.address().port, // Use the actual port the server is listening on
      path: '/speaking',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options);
    req.on('error', (error) => console.error('[ERROR] Failed to report speaking status:', error.message));
    req.write(postData);
    req.end();
  }

  // State and stream management
  let activeStream = null;
  let userState = null;
  const voiceConnections = new Map(); // Track { connection, subscriptions }
  let voiceProbStats = { sum: 0, count: 0, min: 1, max: 0, lastLogTime: 0 };
  let ignoredSpeakingEvents = []; // Track ignored speaking events

  function cleanupStream() {
    const name = userState?.name || 'unknown';
    console.log(`[INFO] Cleaning up stream for user ${name}`);

    if (activeStream) {
      const { opusStream, pcmStream } = activeStream;
      if (pcmStream) {
        pcmStream.removeAllListeners('data');
        try {
          if (pcmStream.readable) pcmStream.unpipe();
          if (!pcmStream.destroyed) pcmStream.destroy();
        } catch (e) {
          console.error(`[ERROR] Failed to destroy pcmStream for user ${name}:`, e.message);
        }
      }
      if (opusStream) {
        try {
          if (opusStream.readable) opusStream.unpipe();
          if (!opusStream.destroyed) opusStream.destroy();
        } catch (e) {
          console.error(`[ERROR] Failed to destroy opusStream for user ${name}:`, e.message);
        }
      }
      activeStream = null;
    }

    if (userState) {
      if (userState.timer) {
        clearTimeout(userState.timer);
        userState.timer = null;
      }
      if (userState.streamTimeout) {
        clearTimeout(userState.streamTimeout);
        userState.streamTimeout = null;
      }
      if (userState.inactivityTimeout) {
        clearTimeout(userState.inactivityTimeout);
        userState.inactivityTimeout = null;
      }
      if (userState.cobra) {
        try {
          userState.cobra.release();
        } catch (e) {
          console.error(`[ERROR] Failed to release Cobra for user ${name}:`, e.message);
        }
        userState.cobra = null;
      }
      if (userState.speaking && userState.lastReportedState !== false) {
        reportSpeaking(name, false);
        userState.lastReportedState = false;
      }
      userState = null;
    }

    voiceProbStats = { sum: 0, count: 0, min: 1, max: 0, lastLogTime: 0 };
    ignoredSpeakingEvents = []; // Reset ignored events
  }

  // Force cleanup and termination
  async function cleanupAndExit() {
    console.log('[INFO] Terminating script, cleaning up resources...');

    if (userState?.streamActive) {
      console.log('[INFO] Forcing cleanup of active stream on termination');
      cleanupStream();
    }

    const disconnectPromise = new Promise(async (resolve) => {
      let disconnectAttempts = 0;
      if (voiceConnections.size > 0) {
        for (const [guildId, { connection, subscriptions }] of voiceConnections.entries()) {
          console.log(`[INFO] Destroying voice connection for guild ${guildId}`);
          try {
            subscriptions.forEach(stream => {
              try {
                if (stream.readable) stream.unpipe();
                if (!stream.destroyed) stream.destroy();
              } catch (e) {
                console.error(`[ERROR] Failed to destroy subscription for guild ${guildId}:`, e.message);
              }
            });
            connection.destroy();
            disconnectAttempts++;
            console.log(`[INFO] Successfully destroyed connection for guild ${guildId}`);
          } catch (e) {
            console.error(`[ERROR] Failed to destroy connection for guild ${guildId}:`, e.message);
          }
        }
        voiceConnections.clear();
      }

      try {
        const promises = [];
        client.guilds.cache.forEach(guild => {
          const connection = getVoiceConnection(guild.id);
          if (connection) {
            console.log(`[INFO] Found voice connection for guild ${guild.name} (${guild.id}), destroying`);
            try {
              connection.destroy();
              disconnectAttempts++;
              console.log(`[INFO] Successfully destroyed connection for guild ${guild.id}`);
            } catch (e) {
              console.error(`[ERROR] Failed to destroy connection for guild ${guild.id}:`, e.message);
            }
          }
          if (guild.members.me && guild.members.me.voice.channelId) {
            console.log(`[INFO] Force resetting voice state for guild ${guild.id}`);
            try {
              promises.push(guild.members.me.voice.disconnect());
              disconnectAttempts++;
            } catch (e) {
              console.error(`[ERROR] Failed to disconnect from voice in guild ${guild.id}:`, e.message);
            }
          }
        });
        if (promises.length > 0) {
          await Promise.allSettled(promises);
        }
      } catch (e) {
        console.error('[ERROR] Error during guild voice disconnection:', e.message);
      }

      if (client.user) {
        try {
          client.user.setPresence({ status: 'invisible' });
          console.log('[INFO] Set bot presence to invisible');
        } catch (e) {
          console.error('[ERROR] Failed to set presence:', e.message);
        }
      }

      console.log(`[INFO] Completed ${disconnectAttempts} voice disconnection attempts`);
      resolve();
    });

    try {
      await Promise.race([
        disconnectPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)) // Increased to 5s
      ]);
    } catch (e) {
      console.warn('[WARN] Voice disconnection timed out, continuing with cleanup');
    }

    try {
      client.destroy();
      console.log('[INFO] Discord client destroyed');
    } catch (e) {
      console.error('[ERROR] Failed to destroy Discord client:', e.message);
    }

    try {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(err => {
        if (err) console.error('[ERROR] Failed to close HTTP server:', err.message);
        console.log('[INFO] HTTP server closed');
        console.log('[INFO] Cleanup complete, exiting');
        process.exit(0);
      });
    } catch (e) {
      console.error('[ERROR] Failed to close HTTP server:', e.message);
      process.exit(1);
    }

    setTimeout(() => {
      console.error('[ERROR] Cleanup timeout, forcing exit');
      process.exit(1);
    }, 3000);
  }

  process.on('SIGINT', async () => {
    console.log('[INFO] Received SIGINT');
    await cleanupAndExit();
  });

  process.on('SIGTERM', async () => {
    console.log('[INFO] Received SIGTERM');
    await cleanupAndExit();
  });

  process.on('SIGBREAK', async () => {
    console.log('[INFO] Received SIGBREAK');
    await cleanupAndExit();
  });

  process.on('uncaughtException', async err => {
    console.error('[ERROR] Uncaught exception:', err.message);
    await cleanupAndExit();
  });

  process.on('unhandledRejection', async err => {
    console.error('[ERROR] Unhandled promise rejection:', err.message);
    await cleanupAndExit();
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.channelId && !newState.channelId && newState.id === userState?.userId) {
      console.log(`[INFO] Target user ${userState?.name} left voice channel`);
      cleanupStream();
    }
  });

  client.on('messageCreate', async message => {
    if (!message.guild) return;
    const content = message.content.trim();

    if (content === '!join') {
      const vcChannel = message.member.voice.channel;
      if (!vcChannel) return message.reply('Join a voice channel first!');

      const existingConnection = getVoiceConnection(message.guild.id);
      if (existingConnection) {
        console.log('[INFO] Destroying existing voice connection');
        existingConnection.destroy();
        voiceConnections.delete(message.guild.id);
        cleanupStream();
      }

      let connection;
      try {
        connection = joinVoiceChannel({
          channelId: vcChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true
        });
      } catch (e) {
        console.error('[ERROR] Failed to join voice channel:', e.message);
        return message.reply('Failed to join voice channel. Please check bot permissions.');
      }

      voiceConnections.set(message.guild.id, { connection, subscriptions: new Set() });
      console.log('[INFO] Joined voice channel');
      message.reply('Joined voice channel for single-user speech detection!');

      const receiver = connection.receiver;

      receiver.speaking.on('start', userId => {
        const member = message.guild.members.cache.get(userId);
        const name = member ? member.displayName : userId;
        if (name.toLowerCase() !== TARGET_USERNAME.toLowerCase()) {
          console.log(`[DEBUG] Ignoring speaking start for non-target user ${name}`);
          return;
        }

        if (userState?.streamActive) {
          console.log(`[DEBUG] Stream already active for user ${userId}`);
          // Track ignored speaking events
          const now = Date.now();
          ignoredSpeakingEvents.push(now);
          // Remove events older than the window
          ignoredSpeakingEvents = ignoredSpeakingEvents.filter(timestamp => now - timestamp <= CONFIG.IGNORED_EVENT_WINDOW);

          if (ignoredSpeakingEvents.length >= CONFIG.MAX_IGNORED_SPEAKING_EVENTS) {
            console.log(`[INFO] Too many ignored speaking events (${ignoredSpeakingEvents.length}) for user ${name}, forcing cleanup`);
            cleanupStream();
          } else if (userState.lastAudioTime && (Date.now() - userState.lastAudioTime > CONFIG.INACTIVITY_TIMEOUT)) {
            console.log(`[INFO] Stream inactive for too long for user ${name}, forcing cleanup`);
            cleanupStream();
          } else {
            console.log(`[DEBUG] Ignoring speaking start for user ${userId}: stream still active`);
            return;
          }
        }

        console.log(`[INFO] Speaking start detected for target user ${name} (${userId})`);
        cleanupStream();

        let cobra;
        try {
          cobra = new Cobra(process.env.COBRA_ACCESS_KEY);
        } catch (e) {
          console.error(`[ERROR] Failed to initialize Cobra for user ${name}:`, e.message);
          return;
        }

        userState = {
          userId,
          name,
          speaking: false,
          timer: null,
          streamTimeout: null,
          inactivityTimeout: null,
          consecutiveSilentFrames: 0,
          cobra,
          lastReportedState: null,
          guildId: message.guild.id,
          speakingStartTime: null,
          streamActive: true,
          lastAudioTime: null
        };

        let opusStream;
        try {
          opusStream = receiver.subscribe(userId, { end: { behavior: 'manual' } });
        } catch (e) {
          console.error(`[ERROR] Failed to subscribe to audio stream for user ${name}:`, e.message);
          cleanupStream();
          return;
        }

        const decoder = new prism.opus.Decoder({
          frameSize: CONFIG.FRAME_SIZE,
          channels: 1,
          rate: 16000
        });
        const pcmStream = opusStream.pipe(decoder);

        const guildData = voiceConnections.get(message.guild.id);
        guildData.subscriptions.add(opusStream);
        voiceConnections.set(message.guild.id, guildData);

        activeStream = { opusStream, pcmStream };
        console.log(`[INFO] Stream started for target user ${name}`);

        userState.streamTimeout = setTimeout(() => {
          console.log(`[INFO] Stream timeout for user ${name}`);
          cleanupStream();
        }, CONFIG.STREAM_TIMEOUT);

        let audioBuffer = Buffer.alloc(0);
        const FRAME_BYTES = CONFIG.FRAME_SIZE * 2;

        pcmStream.on('data', chunk => {
          if (!userState?.cobra || !chunk || chunk.length === 0 || !userState.streamActive) return;

          // Validate audio data (check if it's not just silence)
          let isSilence = true;
          for (let i = 0; i < chunk.length; i += 2) {
            const sample = chunk.readInt16LE(i);
            if (Math.abs(sample) > 100) { // Arbitrary threshold for non-silent audio
              isSilence = false;
              break;
            }
          }
          if (isSilence) {
            console.log(`[DEBUG] Received silent audio data for user ${name}`);
            // Increment silent frame counter to trigger cleanup
            userState.consecutiveSilentFrames++;
            if (userState.consecutiveSilentFrames >= CONFIG.MIN_SILENT_FRAMES) {
              console.log(`[INFO] Too many consecutive silent frames for user ${name}, forcing cleanup`);
              cleanupStream();
            }
            return;
          }

          userState.consecutiveSilentFrames = 0; // Reset on non-silent data
          userState.lastAudioTime = Date.now();

          if (userState.streamTimeout) {
            clearTimeout(userState.streamTimeout);
            userState.streamTimeout = setTimeout(() => {
              console.log(`[INFO] Stream timeout for user ${name}`);
              cleanupStream();
            }, CONFIG.STREAM_TIMEOUT);
          }

          if (userState.inactivityTimeout) {
            clearTimeout(userState.inactivityTimeout);
          }
          userState.inactivityTimeout = setTimeout(() => {
            console.log(`[INFO] Inactivity timeout for user ${name}: no audio data received`);
            cleanupStream();
          }, CONFIG.INACTIVITY_TIMEOUT);

          audioBuffer = Buffer.concat([audioBuffer, chunk]);

          const processAudio = () => {
            if (audioBuffer.length < FRAME_BYTES || !userState.streamActive) return;

            const frame = audioBuffer.slice(0, FRAME_BYTES);
            audioBuffer = audioBuffer.slice(FRAME_BYTES);

            const int16Data = new Int16Array(CONFIG.FRAME_SIZE);
            for (let i = 0; i < CONFIG.FRAME_SIZE; i++) {
              let sample = frame.readInt16LE(i * 2) * CONFIG.GAIN;
              int16Data[i] = Math.max(-32768, Math.min(32767, sample));
            }

            try {
              const voiceProb = userState.cobra.process(int16Data);

              if (DEBUG) {
                voiceProbStats.sum += voiceProb;
                voiceProbStats.count++;
                voiceProbStats.min = Math.min(voiceProbStats.min, voiceProb);
                voiceProbStats.max = Math.max(voiceProbStats.max, voiceProb);

                const now = Date.now();
                if (now - voiceProbStats.lastLogTime >= CONFIG.VOICE_PROB_SUMMARY_INTERVAL) {
                  const avg = voiceProbStats.count > 0 ? (voiceProbStats.sum / voiceProbStats.count).toFixed(2) : 0;
                  console.log(`[DEBUG] VoiceProb summary for ${name}: min=${voiceProbStats.min.toFixed(2)}, max=${voiceProbStats.max.toFixed(2)}, avg=${avg}`);
                  voiceProbStats = { sum: 0, count: 0, min: 1, max: 0, lastLogTime: now };
                }
              }

              if (voiceProb > CONFIG.VOICE_PROBABILITY_THRESHOLD) {
                userState.consecutiveSilentFrames = 0;
                if (!userState.speaking) {
                  userState.speaking = true;
                  userState.speakingStartTime = Date.now();
                  console.log(`[INFO] Speech detected for ${name} (voiceProb=${voiceProb.toFixed(2)})`);
                  if (userState.lastReportedState !== true) {
                    reportSpeaking(name, true);
                    userState.lastReportedState = true;
                  }
                }
                if (userState.timer) {
                  clearTimeout(userState.timer);
                  userState.timer = null;
                }
              } else {
                userState.consecutiveSilentFrames++;
                if (userState.speaking && userState.consecutiveSilentFrames >= CONFIG.MIN_SILENT_FRAMES) {
                  if (userState.timer) clearTimeout(userState.timer);
                  userState.timer = setTimeout(() => {
                    if (userState.speaking) {
                      userState.speaking = false;
                      console.log(`[INFO] Silence detected for ${name} (voiceProb=${voiceProb.toFixed(2)})`);
                      if (userState.lastReportedState !== false) {
                        reportSpeaking(name, false);
                        userState.lastReportedState = false;
                      }
                    }
                    userState.timer = null;
                  }, CONFIG.SILENCE_DETECTION_TIMEOUT);
                }
              }

              if (userState.speaking && userState.speakingStartTime && (Date.now() - userState.speakingStartTime > CONFIG.MAX_SPEAKING_DURATION)) {
                console.log(`[INFO] Force resetting stuck speaking state for user ${name}`);
                userState.speaking = false;
                if (userState.lastReportedState !== false) {
                  reportSpeaking(name, false);
                  userState.lastReportedState = false;
                }
                cleanupStream();
              }
            } catch (err) {
              console.error(`[ERROR] Cobra VAD error for user ${name}:`, err.message);
              cleanupStream();
            }

            if (audioBuffer.length >= FRAME_BYTES && userState.streamActive) {
              setImmediate(processAudio);
            }
          };

          setImmediate(processAudio);
        });

        pcmStream.on('error', err => {
          console.error(`[ERROR] pcmStream error for user ${name}:`, err.message);
          cleanupStream();
        });

        opusStream.on('error', err => {
          console.error(`[ERROR] opusStream error for user ${name}:`, err.message);
          cleanupStream();
        });

        opusStream.on('end', () => {
          console.log(`[INFO] opusStream ended for user ${name}`);
          cleanupStream();
        });
      });

      receiver.speaking.on('stop', userId => {
        if (userId === userState?.userId && userState?.streamActive) {
          console.log(`[INFO] Speaking stop detected for target user ${userState.name}`);
          cleanupStream();
        }
      });
    } else if (content === '!leave') {
      const connection = getVoiceConnection(message.guild.id);
      if (connection) {
        console.log('[INFO] Leaving voice channel via !leave command');
        try {
          connection.destroy();
          voiceConnections.delete(message.guild.id);
          cleanupStream();
          message.reply('Left voice channel.');
        } catch (e) {
          console.error(`[ERROR] Failed to leave voice channel:`, e.message);
          message.reply('Error leaving voice channel.');
        }
      } else {
        message.reply('Not in a voice channel.');
      }
    }
  });

  // Login to Discord
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('[ERROR] Failed to log into Discord:', err.message);
    process.exit(1);
  });
})();
