// music Youtube Bots
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// Music queue and player management
const queues = new Map();

class MusicQueue {
    constructor() {
        this.songs = [];
        this.playing = false;
        this.player = createAudioPlayer();
        this.connection = null;
        this.currentSong = null;
        this.volume = 50; // Default volume 50%
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('music')
            .setDescription('Music bot commands')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('play')
                    .setDescription('Play a song from YouTube')
                    .addStringOption(option =>
                        option.setName('query')
                            .setDescription('Song name or YouTube URL')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('skip')
                    .setDescription('Skip the current song')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('stop')
                    .setDescription('Stop playing and clear the queue')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('queue')
                    .setDescription('Show the current queue')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('nowplaying')
                    .setDescription('Show the currently playing song')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('pause')
                    .setDescription('Pause the current song')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('resume')
                    .setDescription('Resume the paused song')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('leave')
                    .setDescription('Leave the voice channel')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('volume')
                    .setDescription('Set the music volume (0-100)')
                    .addIntegerOption(option =>
                        option.setName('level')
                            .setDescription('Volume level (0-100)')
                            .setRequired(true)
                            .setMinValue(0)
                            .setMaxValue(100)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('help')
                    .setDescription('Show all available music commands')
            )
    ];

    try {
        console.log('Started refreshing application (/) commands.');
        await client.application.commands.set(commands);
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

// Auto-stop when users leave voice channel
client.on('voiceStateUpdate', (oldState, newState) => {
    const queue = queues.get(oldState.guild.id);
    if (!queue || !queue.connection) return;

    // Get the voice channel the bot is in
    const botVoiceChannel = queue.connection.joinConfig.channelId;
    
    // Check if someone left the bot's voice channel
    if (oldState.channelId === botVoiceChannel && newState.channelId !== botVoiceChannel) {
        // Count remaining members in the voice channel (excluding bots)
        const channel = oldState.guild.channels.cache.get(botVoiceChannel);
        if (channel) {
            const members = channel.members.filter(member => !member.user.bot);
            
            // If no human members left, stop the music
            if (members.size === 0) {
                queue.songs = [];
                queue.playing = false;
                queue.currentSong = null;
                queue.player.stop();
                
                if (queue.connection) {
                    queue.connection.destroy();
                    queue.connection = null;
                }
                
                console.log(`Auto-stopped music in guild ${oldState.guild.name} - no users in voice channel`);
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId } = interaction;
    
    if (commandName === 'music') {
        const subcommand = interaction.options.getSubcommand();
        
        // Get or create queue for this guild
        if (!queues.has(guildId)) {
            queues.set(guildId, new MusicQueue());
        }
        const queue = queues.get(guildId);

        switch (subcommand) {
            case 'play':
                await handlePlay(interaction, queue);
                break;
            case 'skip':
                await handleSkip(interaction, queue);
                break;
            case 'stop':
                await handleStop(interaction, queue);
                break;
            case 'queue':
                await handleQueue(interaction, queue);
                break;
            case 'nowplaying':
                await handleNowPlaying(interaction, queue);
                break;
            case 'pause':
                await handlePause(interaction, queue);
                break;
            case 'resume':
                await handleResume(interaction, queue);
                break;
            case 'leave':
                await handleLeave(interaction, queue);
                break;
            case 'volume':
                await handleVolume(interaction, queue);
                break;
            case 'help':
                await handleHelp(interaction);
                break;
        }
    }
});

async function handlePlay(interaction, queue) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply('❌ You need to be in a voice channel to play music!');
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    
    try {
        let song;
        
        if (ytdl.validateURL(query)) {
            // Direct YouTube URL
            const info = await ytdl.getInfo(query);
            song = {
                title: info.videoDetails.title,
                url: query,
                duration: info.videoDetails.lengthSeconds,
                thumbnail: info.videoDetails.thumbnails[0]?.url,
                requestedBy: interaction.user
            };
        } else {
            // Search YouTube
            const results = await YouTube.search(query, { limit: 1, type: 'video' });
            if (!results.length) {
                return interaction.editReply('❌ No results found for your search!');
            }
            
            const video = results[0];
            song = {
                title: video.title,
                url: video.url,
                duration: video.duration,
                thumbnail: video.thumbnail?.url,
                requestedBy: interaction.user
            };
        }

        queue.songs.push(song);

        if (!queue.playing) {
            if (!queue.connection) {
                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guildId,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                });
                
                queue.connection.subscribe(queue.player);
            }
            
            playSong(queue);
        }

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Song Added to Queue')
            .setDescription(`**${song.title}**`)
            .setThumbnail(song.thumbnail)
            .addFields(
                { name: 'Duration', value: formatDuration(song.duration), inline: true },
                { name: 'Position in queue', value: queue.songs.length.toString(), inline: true },
                { name: 'Requested by', value: song.requestedBy.toString(), inline: true }
            );

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error playing song:', error);
        await interaction.editReply('❌ An error occurred while trying to play the song.');
    }
}

async function playSong(queue) {
    if (queue.songs.length === 0) {
        queue.playing = false;
        return;
    }

    queue.playing = true;
    queue.currentSong = queue.songs.shift();
    
    try {
        const stream = ytdl(queue.currentSong.url, {
            filter: 'audioonly',
            fmt: 'mp4',
            highWaterMark: 1 << 25,
            quality: 'highestaudio'
        });

        const resource = createAudioResource(stream, {
            inlineVolume: true
        });
        resource.volume.setVolume(queue.volume / 100);
        queue.player.play(resource);

        queue.player.once(AudioPlayerStatus.Idle, () => {
            playSong(queue);
        });

    } catch (error) {
        console.error('Error playing song:', error);
        queue.playing = false;
    }
}

async function handleSkip(interaction, queue) {
    if (!queue.playing || !queue.currentSong) {
        return interaction.reply('❌ No song is currently playing!');
    }

    queue.player.stop();
    
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('⏭️ Song Skipped')
        .setDescription(`Skipped: **${queue.currentSong.title}**`);

    await interaction.reply({ embeds: [embed] });
}

async function handleStop(interaction, queue) {
    if (!queue.playing) {
        return interaction.reply('❌ No music is currently playing!');
    }

    queue.songs = [];
    queue.playing = false;
    queue.currentSong = null;
    queue.player.stop();
    
    if (queue.connection) {
        queue.connection.destroy();
        queue.connection = null;
    }

    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('⏹️ Music Stopped')
        .setDescription('Stopped playing and cleared the queue.');

    await interaction.reply({ embeds: [embed] });
}

async function handleQueue(interaction, queue) {
    if (queue.songs.length === 0 && !queue.currentSong) {
        return interaction.reply('❌ The queue is empty!');
    }

    let queueString = '';
    
    if (queue.currentSong) {
        queueString += `**Now Playing:**\n🎵 ${queue.currentSong.title}\n\n`;
    }
    
    if (queue.songs.length > 0) {
        queueString += '**Up Next:**\n';
        queue.songs.slice(0, 10).forEach((song, index) => {
            queueString += `${index + 1}. ${song.title}\n`;
        });
        
        if (queue.songs.length > 10) {
            queueString += `\n...and ${queue.songs.length - 10} more songs`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎵 Music Queue')
        .setDescription(queueString);

    await interaction.reply({ embeds: [embed] });
}

async function handleNowPlaying(interaction, queue) {
    if (!queue.currentSong) {
        return interaction.reply('❌ No song is currently playing!');
    }

    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎵 Now Playing')
        .setDescription(`**${queue.currentSong.title}**`)
        .setThumbnail(queue.currentSong.thumbnail)
        .addFields(
            { name: 'Duration', value: formatDuration(queue.currentSong.duration), inline: true },
            { name: 'Volume', value: `${queue.volume}%`, inline: true },
            { name: 'Requested by', value: queue.currentSong.requestedBy.toString(), inline: false }
        );

    await interaction.reply({ embeds: [embed] });
}

async function handlePause(interaction, queue) {
    if (!queue.playing) {
        return interaction.reply('❌ No music is currently playing!');
    }

    queue.player.pause();
    
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('⏸️ Music Paused')
        .setDescription('Music has been paused.');

    await interaction.reply({ embeds: [embed] });
}

async function handleResume(interaction, queue) {
    if (!queue.playing) {
        return interaction.reply('❌ No music is currently playing!');
    }

    queue.player.unpause();
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('▶️ Music Resumed')
        .setDescription('Music has been resumed.');

    await interaction.reply({ embeds: [embed] });
}

async function handleLeave(interaction, queue) {
    if (!queue.connection) {
        return interaction.reply('❌ I am not connected to a voice channel!');
    }

    queue.songs = [];
    queue.playing = false;
    queue.currentSong = null;
    queue.player.stop();
    queue.connection.destroy();
    queue.connection = null;

    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('👋 Left Voice Channel')
        .setDescription('Disconnected from the voice channel.');

    await interaction.reply({ embeds: [embed] });
}

async function handleVolume(interaction, queue) {
    const volume = interaction.options.getInteger('level');
    
    queue.volume = volume;
    
    // Apply volume to current playing song if any
    if (queue.playing && queue.player.state.resource && queue.player.state.resource.volume) {
        queue.player.state.resource.volume.setVolume(volume / 100);
    }

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🔊 Volume Changed')
        .setDescription(`Volume set to **${volume}%**`)
        .addFields(
            { name: 'Volume Level', value: getVolumeBar(volume), inline: false }
        );

    await interaction.reply({ embeds: [embed] });
}

async function handleHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎵 Music Bot Commands')
        .setDescription('Here are all the available music commands:')
        .addFields(
            { name: '/music play <query>', value: 'Play a song from YouTube (name or URL)', inline: false },
            { name: '/music skip', value: 'Skip the current song', inline: false },
            { name: '/music stop', value: 'Stop playing and clear the queue', inline: false },
            { name: '/music pause', value: 'Pause the current song', inline: false },
            { name: '/music resume', value: 'Resume the paused song', inline: false },
            { name: '/music queue', value: 'Show the current queue', inline: false },
            { name: '/music nowplaying', value: 'Show the currently playing song', inline: false },
            { name: '/music volume <0-100>', value: 'Set the music volume', inline: false },
            { name: '/music leave', value: 'Leave the voice channel', inline: false },
            { name: '/music help', value: 'Show this help message', inline: false }
        )
        .setFooter({ text: 'You must be in a voice channel to use music commands!' });

    await interaction.reply({ embeds: [embed] });
}

function formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getVolumeBar(volume) {
    const barLength = 20;
    const filledLength = Math.round((volume / 100) * barLength);
    const emptyLength = barLength - filledLength;
    
    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(emptyLength);
    
    return `${filledBar}${emptyBar} ${volume}%`;
}

// Error handling
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login with environment variable
const DISCORD_BOT_TOKEN = 'BOT-TOKEN';

if (!DISCORD_BOT_TOKEN) {
    console.error('DISCORD_BOT_TOKEN environment variable is required!');
    process.exit(1);
}

client.login(DISCORD_BOT_TOKEN);
