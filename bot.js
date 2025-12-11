// Add these new imports
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, 
    Collection, ModalBuilder, TextInputBuilder, TextInputStyle , ComponentType,
    ActivityType // Added for setstatus terminal command
} = require('discord.js');

const fs = require('fs');
require('dotenv').config({ path: './TOKEN.env' }); // Load the TOKEN.env file
console.log(`Checking token load status: ${process.env.DISCORD_TOKEN ? 'SUCCESS' : 'FAILURE'}`);

// ... rest of your code ...
// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN
const PREFIX = 'agent ';
const DATA_FILE = './data.json';
const readline = require('readline');
const Server_Url = process.env.VERIFICATION_SERVER_URL || "http://localhost:3000";
const VERIFICATION_GUILD_ID = process.env.VERIFICATION_GUILD_ID;

const PENDING_FILE = './pending.json';

function loadPending() {
    if (!fs.existsSync(PENDING_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    } catch (e) { return {}; }
}

function savePending(data) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 4));
}

// --- TERMINAL SETTINGS CONFIGURATION ---
const SETTINGS_FILE = './bot_settings.json';
let guildCache = []; // Used to map numbers to Guild IDs

// Load Bot Settings (Enabled/Disabled Servers)
function loadSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        const defaultSettings = { disabledGuilds: [] };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 4));
        return defaultSettings;
    }
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

// Save Bot Settings
function saveBotSettings(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 4));
}

// --- CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel] // Required to receive DMs
});

// --- COOLDOWNS ---
const cooldowns = new Collection();

// --- STATE MANAGEMENT FOR TEMPLATE WIZARD ---
// Stores user session data for the template generator
const templateSessions = new Map();

// --- HELPER FUNCTIONS ---

// Load JSON Data (Safe Version)
function loadData() {
    const defaultData = {
        users: {},
        revoked_keys: [],
        config: { version: "1.0.0", status: "detected" },
        verify_site_data: {}
    };

    // 1. If file doesn't exist, create it
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 4));
        return defaultData;
    }

    // 2. Try to read and parse. If it fails (empty/corrupt), reset it.
    try {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        if (!rawData.trim()) throw new Error("Empty file"); // Force reset if empty
        return JSON.parse(rawData);
    } catch (error) {
        console.log("⚠️ data.json was corrupted or empty. Resetting to defaults to prevent crash.");
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 4));
        return defaultData;
    }
}

// Save JSON Data
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

// Generate Key
function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${result}-Rloader`;
}

// Sanitize Loadstring: Ensures Load = 'loadstring(game:HttpGet("..."))' format (Outer single, inner double)
function sanitizeLoadstring(str) {
    let s = str.trim();
    
    // 1. Remove outer wrapper quotes (single or double) if they exist.
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }

    // 2. Ensure string arguments inside the Lua code (like URLs) use double quotes.
    // This looks for single-quoted strings inside the main expression and converts them to double quotes.
    // This is the most critical fix for consistency.
    s = s.replace(/'([^']+)'/g, '"$1"');
    
    // 3. Final wrapper: Ensure the entire loadstring expression is enclosed in single quotes.
    return "'" + s + "'";
}

// Format Lua Table
function formatLua(gamename, scripts) {
    let lua = `    ["${gamename}"] = {\n`;
    scripts.forEach(script => {
        lua += `        {\n`;
        lua += `            Name = "${script.Name}",\n`;
        lua += `            Icon = "${script.Icon}",\n`;
        lua += `            Description = "${script.Description}",\n`;
        lua += `            Load = ${script.Load}\n`;
        lua += `        },\n`;
    });
    lua += `    },`;
    return lua;
}

// Helper to save current template session data to user's saved_template, and update last_save_game
const saveSessionSafe = (userId, session) => {
    const data = loadData();
    if(!data.users[userId]) data.users[userId] = {};
    
    // Ensure saved_template exists
    if(!data.users[userId].saved_template) data.users[userId].saved_template = {};
    
    // Update THIS game, keep others
    data.users[userId].saved_template[session.gamename] = session.scripts;
    
    // Update the last saved/modified game (New Feature)
    data.users[userId].last_save_game = session.gamename;
    
    saveData(data);
};

// --- BOT EVENTS ---

client.once('ready', () => {
    // 1. Load Data
    loadData(); 

    // --- AUTO-CLEANUP PENDING JSON ---
    // Checks every 5 minutes and deletes requests older than 10 minutes
    setInterval(() => {
        const pending = loadPending();
        const now = Date.now();
        let changed = false;
        const TIMEOUT = 10 * 60 * 1000; // 10 Minutes in milliseconds

        for (const [userId, data] of Object.entries(pending)) {
            const requestTime = new Date(data.timestamp).getTime();
            
            // If request is older than 10 mins, delete it
            if (now - requestTime > TIMEOUT) {
                delete pending[userId];
                changed = true;
                console.log(`🧹 Auto-cleaned stale request for User ID: ${userId}`);
            }
        }

        if (changed) {
            savePending(pending);
        }
    }, 5 * 60 * 1000); // Run check every 5 minutes
    
    // 2. Force Invisible Mode (Bot appears offline)
    client.user.setPresence({ status: 'invisible' });

    console.log(`\n✅ Logged in as ${client.user.tag}`);
    console.log("👻 Status set to INVISIBLE. The bot is hidden.");
    console.log("👉 Use the terminal command 'setstatus' to go online.\n");

    
});
// --- MESSAGE HANDLER (Commands & Inputs) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // --- CHECK IF SERVER IS DISABLED ---
    if (message.guild) {
        const settings = loadSettings();
        if (settings.disabledGuilds.includes(message.guild.id)) {
            return; // Ignore commands from this server
        }
    }

    // 1. Handle Template Wizard Inputs (If user is typing info for the blue panel)
    if (templateSessions.has(message.author.id)) {
        const session = templateSessions.get(message.author.id);
        if (session.awaitingInput) {
            const field = session.awaitingInput;
            const content = message.content;

            // Update Session Data
            if (field === 'gamename') {
                // If game name changes, save the old one first, then update session, then save new one
                if (session.gamename !== content) {
                     // Check for conflict (optional but good practice)
                    const data = loadData();
                    if(data.users[message.author.id] && data.users[message.author.id].saved_template && data.users[message.author.id].saved_template[content]) {
                        // Conflict: Game name already exists. For now, we allow overwrite.
                    }
                    session.gamename = content;
                } else {
                    session.gamename = content;
                }
            } else {
                if (field === 'Load') {
                    // *** THIS CALL USES THE CORRECTED sanitizeLoadstring ***
                    session.scripts[session.index][field] = sanitizeLoadstring(content);
                } else {
                    session.scripts[session.index][field] = content;
                }
            }

            // Reset Input State
            session.awaitingInput = null;
            
            // Save the session after input to persist the change
            saveSessionSafe(message.author.id, session);
            
            // Delete user message to keep chat clean
            try { await message.delete(); } catch (e) {}

            // Update the Panel
            updateTemplatePanel(session, message.channel);
            return;
        }
    }

    // 2. Command Handling
    if (!message.content.toLowerCase().startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // COOLDOWN CHECK
    if (!cooldowns.has(command)) {
        cooldowns.set(command, new Collection());
    }
    const now = Date.now();
    const timestamps = cooldowns.get(command);
    const cooldownAmount = 3000; // 3 seconds

    if (timestamps.has(message.author.id)) {
        const expirationTime = timestamps.get(message.author.id) + cooldownAmount;
        if (now < expirationTime) {
            return message.reply("Please wait before using this command again.");
        }
    }
    timestamps.set(message.author.id, now);
    setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

    // --- COMMAND LOGIC ---

    // COMMAND: Get Key
    if (command === 'key' || command === 'getkey') {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_lifetime')
                    .setLabel('Lifetime')
                    .setStyle(ButtonStyle.Success)
            );

        const embed = new EmbedBuilder()
            .setTitle("Key System")
            .setDescription("Click below to generate your **Lifetime Key**.")
            .setColor(0x0099FF);

        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // COMMAND: Help
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("Agent Bot | Command Panel")
            .setDescription("Below is the list of available commands and their functions.")
            .setColor(0x0099FF)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { 
                    name: '👤 User Commands', 
                    value: [
                        `**${PREFIX}key** - Generates your lifetime key (sent via DM).`,
                        `**${PREFIX}verify** - Opens the verification panel/website.`,
                        `**${PREFIX}request** - Request a script to be added (Starts Ticket).`,
                        `**${PREFIX}github** - Displays the GitHub repository link.`,
                        `**${PREFIX}commits** - Shows the latest changes/updates.`,
                        `**${PREFIX}version** - Checks R-loader version and status.`
                    ].join('\n')
                },
                { 
                    name: '📤 Uploader Commands', 
                    value: `**${PREFIX}upload** - Upload a script for verification (Requires 'Uploader' Role).`
                },
                { 
                    name: '🛡️ Admin Commands', 
                    value: [
                        `**${PREFIX}revokekey** - Revoke a user's access key.`,
                        `**${PREFIX}template** - Open the Multi-Mode Template Generator.`,
                        `**${PREFIX}load save** - Load your previously saved template session.`,
                        `**${PREFIX}print** - Output the Lua code of your last saved script.`,
                        `**${PREFIX}saves** - Browse all your saved templates.`
                    ].join('\n')
                }
            )
            .setFooter({ text: `Bot Prefix: ${PREFIX}` });

        return message.channel.send({ embeds: [embed] });
    }

 // COMMAND: Saves (Browser) with Delete Button
    if (command === 'saves') {
        const data = loadData();
        const uid = message.author.id;
        
        // Check if user has data
        if (!data.users[uid] || !data.users[uid].saved_template) {
            return message.channel.send("❌ You have no saves.");
        }

        const saved = data.users[uid].saved_template;
        const keys = Object.keys(saved); // Get list of Game Names
        
        if (keys.length === 0) return message.channel.send("❌ Save file is empty.");

        // We start at Index 0
        const index = 0;
        const gameName = keys[index];
        const scripts = saved[gameName];
        
        // Generate the Blue Embed
        const embed = new EmbedBuilder()
            .setTitle(`💾 Save: ${gameName}`)
            .setDescription(`**Entry ${index + 1}/${keys.length}**\n\`\`\`lua\n${formatLua(gameName, scripts)}\n\`\`\``)
            .setColor(0x0099FF) // Blue
            .setFooter({ text: `Hidden Index: ${index}` });

        // Create Buttons: Back | Delete | Next
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`saves_nav_${index - 1}`)
                .setLabel('◀ Back')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true), 
            new ButtonBuilder()
                .setCustomId(`saves_delete_${index}`) // New Delete Button
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`saves_nav_${index + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(keys.length <= 1)
        );

        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // COMMAND: Clear / Purge
    if (command === 'clear') {
        // 1. Check Permissions
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return message.reply("You need 'Manage Messages' permissions.");
        }

        const amountArg = args[0]; // args[0] is the number

        // 2. Logic: If number provided, delete that amount. If NOT, clear ALL.
        if (amountArg) {
            const amount = parseInt(amountArg);

            if (isNaN(amount) || amount < 1 || amount > 100) {
                return message.reply("Please provide a number between 1 and 100.");
            }

            // Bulk Delete is limited to 100 at a time by Discord API
            await message.channel.bulkDelete(amount, true).catch(err => {
                message.channel.send("❌ Error: Cannot delete messages older than 14 days.");
            });

            // Send confirmation and delete it after 3 seconds
            const msg = await message.channel.send(`🧹 Deleted **${amount}** messages.`);
            setTimeout(() => msg.delete().catch(() => {}), 3000);

        } else {
            // 3. Clear Entire Chat (No number provided)
            // We use a loop because API only deletes 100 at a time
            const confirmMsg = await message.channel.send("⚠️ **Clearing entire chat...** (This might take a moment)");
            
            try {
                let fetched;
                do {
                    // Fetch the last 100 messages
                    fetched = await message.channel.messages.fetch({ limit: 100 });
                    
                    // Stop if only 1 message is left (the confirmation message itself)
                    if (fetched.size === 0) break;

                    // Delete them
                    await message.channel.bulkDelete(fetched, true);
                
                // Keep looping as long as we grabbed a full batch of 100 (meaning there's probably more)
                } while (fetched.size >= 2);

                const finalMsg = await message.channel.send("✅ Chat cleared.");
                setTimeout(() => finalMsg.delete().catch(() => {}), 3000);
            
            } catch (error) {
                message.channel.send("❌ Stopped: Cannot delete messages older than 14 days.");
            }
        }
        return;
    }
// COMMAND: Upload (Strict: Verified + Role Only)
    if (command === 'upload') {
        
        // 1. Load Data & Permissions Check
        const data = loadData();
        const uid = message.author.id;
        const isVerifiedInternal = data.users[uid] && data.users[uid].verified;
        const uploaderRole = message.guild.roles.cache.find(r => r.name === "Uploader");
        const hasRole = message.member.roles.cache.has(uploaderRole?.id);
        const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if ((!isVerifiedInternal || !hasRole) && !isAdmin) {
            return; 
        }

        const filter = m => m.author.id === message.author.id;
        const createPanel = (title, desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x9B59B6).setFooter({ text: "Type 'cancel' to stop." });

        try {
            // STEP 1: GAME NAME
            await message.channel.send({ embeds: [createPanel('1️⃣  Upload: Game Name', 'Enter the **Game Name**:')] });
            const m1 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const gameName = m1.first().content;
            if (gameName.toLowerCase() === 'cancel') return message.channel.send("❌ Cancelled.");

            // STEP 2: GAME ID
            await message.channel.send({ embeds: [createPanel('2️⃣  Upload: Game ID', 'Enter the **Game ID**:')] });
            const m2 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const gameId = m2.first().content;
            if (gameId.toLowerCase() === 'cancel') return message.channel.send("❌ Cancelled.");

            // STEP 3: KEY CHECK
            const keyCheckEmbed = new EmbedBuilder().setTitle("3️⃣  Key System Check").setDescription("Does this script require a Key System?").setColor(0xF1C40F);
            const keyButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('key_check_yes').setLabel('Yes (Has Key)').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('key_check_no').setLabel('No (No Key)').setStyle(ButtonStyle.Success)
            );

            const keyMsg = await message.channel.send({ embeds: [keyCheckEmbed], components: [keyButtons] });
            const btnFilter = (i) => i.user.id === message.author.id;
            const interaction = await keyMsg.awaitMessageComponent({ filter: btnFilter, time: 30000, componentType: ComponentType.Button });

            await interaction.deferUpdate(); 
            if (interaction.customId === 'req_key_yes') {
                await interaction.update({ 
                    content: "❌ **Discarded**: Scripts containing key systems, Linkvertise, or ads are not allowed.", 
                    embeds: [], 
                    components: [] 
                });
                return; // Stop everything
            }
            await interaction.editReply({ embeds: [], components: [], content: "✅ Confirmed: No Key." });

            // STEP 4: SCRIPT
            await message.channel.send({ embeds: [createPanel('4️⃣  Script Code', 'Paste the **loadstring** or **script** below:')] });
            const m3 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const scriptLua = m3.first().content;
            const scriptContentLower = scriptLua.toLowerCase();

            if (scriptContentLower === 'cancel') {
                return message.channel.send("❌ Cancelled.");
            }
            
            // Check for key-related terms using the already lowercased content
            if (scriptContentLower.includes("key") || scriptContentLower.includes("linkvertise") || scriptContentLower.includes("ad")) {
                 return message.channel.send("❌ **Auto-Detection**: Key, Linkvertise, or similar keyword found in script. Upload rejected.");
            }


            // ==========================================
            // FINALIZATION: POST TO CHANNELS
            // ==========================================
            const guild = message.guild;

            // 1. Get Public Channel
            let publicChannel = guild.channels.cache.find(c => c.name === 'user-verified-scripts');
            if (!publicChannel) {
                publicChannel = await guild.channels.create({ 
                    name: 'user-verified-scripts', 
                    type: ChannelType.GuildText,
                    permissionOverwrites: [{ id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }] 
                });
            }

            // 2. Get Admin Channel
            let adminChannel = guild.channels.cache.find(c => c.name === 'admin-requests');
            if (!adminChannel) adminChannel = await guild.channels.create({ name: 'admin-requests', type: ChannelType.GuildText });

            // 3. PUBLIC EMBED (Detailed)
            const publicEmbed = new EmbedBuilder()
                .setTitle(`📜 ${gameName}`)
                .setDescription(`**Status:** ⏳ Pending Admin Review`)
                .addFields(
                    { name: "👤 Uploader", value: `<@${message.author.id}>`, inline: true },
                    { name: "🆔 Game ID", value: gameId, inline: true },
                    { name: "🔑 Key System", value: "None", inline: true },
                    { name: "📄 Script", value: "```lua\n" + scriptLua.substring(0, 500) + "\n```" }
                )
                .setColor(0xF1C40F) 
                .setTimestamp();

            const publicMsg = await publicChannel.send({ embeds: [publicEmbed] });

            // 4. ADMIN EMBED (Detailed)
            const adminEmbed = new EmbedBuilder()
                .setTitle("🚨 New Upload Review")
                .setDescription(`**Channel:** <#${publicChannel.id}>`)
                .addFields(
                    { name: "👤 Uploader", value: `<@${message.author.id}>`, inline: true },
                    { name: "🎮 Game Name", value: gameName, inline: true },
                    { name: "🆔 Game ID", value: gameId, inline: true },
                    { name: "📄 Full Script", value: "```lua\n" + scriptLua.substring(0, 950) + "\n```" }
                )
                .setColor(0x9B59B6);

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`up_ver_${publicMsg.id}_${message.author.id}`).setLabel('Verify').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`up_uns_${publicMsg.id}_${message.author.id}`).setLabel('Unsure').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`up_dis_${publicMsg.id}_${message.author.id}`).setLabel('Discard').setStyle(ButtonStyle.Danger)
            );

            await adminChannel.send({ content: "Review Required:", embeds: [adminEmbed], components: [adminRow] });
            await message.channel.send(`✅ **Uploaded!** Your script is now pending review in ${publicChannel}.`);

        } catch (e) {
            console.log(e);
            message.channel.send("❌ Timeout or Error.");
        }
        return;
    }
    // COMMAND: Revoke Key (Admin)
    if (command === 'revokekey') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        message.channel.send("Please enter the **Username** (not Display Name) of the user to revoke:");
        
        const filter = m => m.author.id === message.author.id;
        try {
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
            const targetUsername = collected.first().content;
            
            const data = loadData();
            let targetId = null;
            let userKey = null;

            // Find User ID by Username
            for (const [uid, udata] of Object.entries(data.users)) {
                if (udata.username === targetUsername && udata.key) {
                    targetId = uid;
                    userKey = udata.key;
                    break;
                }
            }

            if (targetId) {
                const embed = new EmbedBuilder()
                    .setTitle("Revoke Key")
                    .setDescription(`User: **${targetUsername}**\nKey: \`${userKey}\``)
                    .setColor(0xFF0000);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`revoke_confirm_${targetId}`).setLabel('Revoke').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('revoke_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    );

                await message.channel.send({ embeds: [embed], components: [row] });
            } else {
                await message.channel.send("User not found or key already revoked.");
            }
        } catch (e) {
            message.channel.send("Timed out.");
        }
        return;
    }

    // COMMAND: GitHub
    if (command === 'github') {
        const embed = new EmbedBuilder()
            .setTitle("GitHub")
            .setDescription("[Click here for GitHub](https://github.com/mixxgaurdian/9Il1i6U8nh6N6lhWMyXhMl8Lcs8QZ7Z5IvpTf65soIGjgMYO8N)") // Replace with real link
            .setColor(0x333333);
        return message.channel.send({ embeds: [embed] });
    }

    // COMMAND: Commits
    if (command === 'commits') {
        // Simulating reading latest commit
        const embed = new EmbedBuilder()
            .setTitle("Latest GitHub Commit")
            .setDescription("Updated `main.lua` to support new bypass.\n**Hash:** `a1b2c3d`")
            .setColor(0x00FF00);
        return message.channel.send({ embeds: [embed] });
    }

    // COMMAND: R-loader Version
    if (command === 'version') {
        const data = loadData();
        return message.channel.send(`**R-loader Version:** ${data.config.version}\n**Status:** ${data.config.status}`);
    }

    // COMMAND: Verify
    if (command === 'verify') {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setLabel('Go to Website').setStyle(ButtonStyle.Link).setURL(Server_Url),
                new ButtonBuilder().setCustomId('btn_check_verify').setLabel('Verify').setStyle(ButtonStyle.Primary)
            );
        
        const embed = new EmbedBuilder()
            .setTitle("Verification")
            .setDescription("Please visit the website to verify your account, then click Verify below.")
            .setColor(0x00FF00);
        
        return message.channel.send({ embeds: [embed], components: [row] });
    }

// COMMAND: Script Request
    if (command === 'request') {
        const filter = m => m.author.id === message.author.id;
        
        // Standardized function to make panels look the same size/style
        const createPanel = (title, desc) => {
            return new EmbedBuilder()
                .setTitle(title)
                .setDescription(desc)
                .setColor(0x0099FF) // Uniform Blue Color
                .setFooter({ text: "Type 'cancel' to stop request." });
        };

        try {
            // ==========================================
            // STEP 1: GAME NAME
            // ==========================================
            await message.channel.send({ 
                embeds: [createPanel('1️⃣  Game Name', 'Please enter the **Game Name** below:')] 
            });
            
            const m1 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const gameName = m1.first().content;
            if (gameName.toLowerCase() === 'cancel') return message.channel.send("❌ Request cancelled.");


            // ==========================================
            // STEP 2: GAME ID
            // ==========================================
            await message.channel.send({ 
                embeds: [createPanel('2️⃣  Game ID', 'Please enter the **Game ID** (numbers only):')] 
            });

            const m2 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const gameId = m2.first().content;
            if (gameId.toLowerCase() === 'cancel') return message.channel.send("❌ Request cancelled.");


            // ==========================================
            // STEP 3: KEY CHECK (MOVED BEFORE SCRIPT)
            // ==========================================
            const keyCheckEmbed = new EmbedBuilder()
                .setTitle("3️⃣  Key System Check")
                .setDescription("Does this script require a Key System, Linkvertise, or ads to work?")
                .setColor(0xF1C40F) // Warning Yellow to stand out slightly
                .setFooter({ text: "Select an option below." });

            const keyButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('req_key_yes').setLabel('Yes (Has Key)').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('req_key_no').setLabel('No (No Key)').setStyle(ButtonStyle.Success)
            );

            const keyMsg = await message.channel.send({ embeds: [keyCheckEmbed], components: [keyButtons] });

            // Wait for Button Click
            const buttonFilter = (i) => i.user.id === message.author.id;
            const interaction = await keyMsg.awaitMessageComponent({ 
                filter: buttonFilter, 
                time: 30000, 
                componentType: ComponentType.Button 
            });

            // BRANCH A: HAS KEY -> DISCARD
            if (interaction.customId === 'req_key_yes') {
                await interaction.update({ 
                    content: "❌ **Discarded**: Scripts containing key systems are not allowed.", 
                    embeds: [], 
                    components: [] 
                });
                return; // Stop everything
            }

            // BRANCH B: NO KEY -> CONTINUE
            if (interaction.customId === 'req_key_no') {
                // Remove the buttons and show "Processing..." logic
                await interaction.update({ embeds: [], components: [], content: "✅ No Key confirmed. Proceeding..." });
                
                // ==========================================
                // STEP 4: SCRIPT CODE (MOVED TO END)
                // ==========================================
                await message.channel.send({ 
                    embeds: [createPanel('4️⃣  Script Code', 'Please paste the **Lua Script** below:')] 
                });

                const m3 = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
                const scriptLua = m3.first().content;
                if (scriptLua.toLowerCase() === 'cancel') return message.channel.send("❌ Request cancelled.");

                // Optional: Double check text for "key" just in case they lied (Optional security layer)
                if (scriptLua.toLowerCase().includes("key")) {
                     return message.channel.send("❌ **Auto-Detection**: You said 'No Key', but the script contains the word 'key'. Request discarded.");
                }

                // ==========================================
                // FINAL STEP: CREATE TICKET
                // ==========================================
                const guild = message.guild;
                
                // Ensure Admin/Ticket Channels exist (Standard logic)
                let adminChannel = guild.channels.cache.find(c => c.name === 'admin-requests');
                if (!adminChannel) {
                    adminChannel = await guild.channels.create({ 
                        name: 'admin-requests', 
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: message.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                        ]
                    });
                }

                const ticketName = `ticket-${message.author.username}`.toLowerCase().replace(/[^a-z0-9]/g, '');
                const ticketChannel = await guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                    ]
                });

                // Summary Embed
                const infoEmbed = new EmbedBuilder()
                    .setTitle("📜 New Script Request")
                    .setDescription(`Requested by <@${message.author.id}>`)
                    .addFields(
                        { name: "🎮 Game", value: gameName, inline: true },
                        { name: "🆔 ID", value: gameId, inline: true }, 
                        { name: "📄 Code", value: "```lua\n" + scriptLua.substring(0, 1000) + "\n```" }
                    )
                    .setColor(0xF1C40F)
                    .setTimestamp();
                
                // Admin Buttons
                const adminRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ticket_accept_${ticketChannel.id}_${message.author.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ticket_discard_${ticketChannel.id}_${message.author.id}`).setLabel('Discard').setStyle(ButtonStyle.Danger)
                );

                await adminChannel.send({ content: `🚨 **New Request!**`, embeds: [infoEmbed], components: [adminRow] });
                await ticketChannel.send({ content: `${message.author} **Request Received.**`, embeds: [infoEmbed] });
                
                await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`✅ **Ticket Created:** ${ticketChannel}`).setColor(0x00FF00)] });
            }

        } catch (e) {
            console.log(e); // Log detailed error to console
            message.channel.send("❌ **Timeout or Error**: Request cancelled.");
        }
        return;
    }


    // COMMAND: Template
    if (command === 'template') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        // Initialize Session
        templateSessions.set(message.author.id, {
            mode: 'single',
            index: 0,
            gamename: 'gamenameexample',
            scripts: [{ Name: 'example', Icon: 'http://', Description: 'desc', Load: 'loadstring()' }],
            messageId: null,
            awaitingInput: null
        });

        const session = templateSessions.get(message.author.id);
        
        const embed = new EmbedBuilder()
            .setTitle("Template Generator")
            .setDescription("Loading...")
            .setColor(0x0099FF);

        const msg = await message.channel.send({ embeds: [embed] });
        session.messageId = msg.id;
        
        updateTemplatePanel(session, message.channel);
        return;
    }

    // COMMAND: Load Save (Template)
    if (command === 'load' && args[0] === 'save') {
        const data = loadData();
        const uid = message.author.id;

        if (data.users[uid] && data.users[uid].saved_template) {
            const saved = data.users[uid].saved_template;
            
            // Use last_save_game if it exists, otherwise use the first game in the object
            const lastSaveGameName = data.users[uid].last_save_game || Object.keys(saved)[0];
            
            if (!lastSaveGameName) return message.channel.send("No save found to load.");

            const scripts = saved[lastSaveGameName];

            templateSessions.set(uid, {
                mode: scripts.length > 1 ? 'multi' : 'single', // Start in multi if more than one script
                index: 0,
                gamename: lastSaveGameName,
                scripts: scripts,
                messageId: null,
                awaitingInput: null
            });

            const session = templateSessions.get(uid);
            const embed = new EmbedBuilder().setTitle(`Template Loaded: ${lastSaveGameName}`).setColor(0x0099FF);
            const msg = await message.channel.send({ embeds: [embed] });
            session.messageId = msg.id;
            updateTemplatePanel(session, message.channel);
        } else {
            message.channel.send("No save found.");
        }
        return;
    }

    // COMMAND: Print Last
    if (command === 'print') {
         const data = loadData();
         const uid = message.author.id;
         if (data.users[uid] && data.users[uid].saved_template) {
             const saved = data.users[uid].saved_template;
             // Use last_save_game field
             const gn = data.users[uid].last_save_game || Object.keys(saved)[0];
             
             if (gn && saved[gn]) {
                 const lua = formatLua(gn, saved[gn]);
                 message.channel.send(`**Last Saved (${gn}):**\n\`\`\`lua\n${lua}\n\`\`\``);
             } else {
                 message.channel.send("No saved script or last save game not found.");
             }
         } else {
             message.channel.send("No saved script.");
         }
    }
});
    
// --- INTERACTION HANDLER (Buttons & Modals) ---
client.on('interactionCreate', async interaction => {
    
    // ====================================================
    // PART 1: BUTTON HANDLER
    // ====================================================
    if (interaction.isButton()) {

        // 1. KEY SYSTEM: Lifetime Button
        if (interaction.customId === 'btn_lifetime') {
            const data = loadData();
            const uid = interaction.user.id;
            const newKey = generateKey();

            if (!data.users[uid]) data.users[uid] = {};
            
            data.users[uid].key = newKey;
            data.users[uid].username = interaction.user.username;
            saveData(data);

            try {
                await interaction.user.send(`Here is your Lifetime Key: \`${newKey}\``);
                await interaction.reply({ content: "Key sent to your DMs!", ephemeral: true });
            } catch (e) {
                await interaction.reply({ content: "I could not DM you. Please open your DMs.", ephemeral: true });
            }
        }

        // 2. REVOKE SYSTEM
        if (interaction.customId.startsWith('revoke_confirm_')) {
            const targetId = interaction.customId.split('_')[2];
            const data = loadData();
            
            if (data.users[targetId] && data.users[targetId].key) {
                const revokedKey = data.users[targetId].key;
                delete data.users[targetId].key;
                
                data.revoked_keys.push({
                    user: data.users[targetId].username,
                    key: revokedKey,
                    admin: interaction.user.username,
                    time: new Date().toISOString()
                });
                saveData(data);

                const embed = new EmbedBuilder().setTitle("Revoked").setDescription("Key has been revoked.").setColor(0xFF0000);
                await interaction.update({ embeds: [embed], components: [] });
            } else {
                await interaction.update({ content: "Key already revoked or user data missing.", components: [] });
            }
        }
        if (interaction.customId === 'revoke_cancel') {
            await interaction.update({ content: "Cancelled.", components: [], embeds: [] });
        }

        // 3. TICKET SYSTEM: Accept
        if (interaction.customId.startsWith('ticket_accept_')) {
            const [, , channelId, userId] = interaction.customId.split('_');
            const channel = interaction.guild.channels.cache.get(channelId);
            
            if (channel) {
                const acceptEmbed = new EmbedBuilder()
                    .setTitle('✅ Request Accepted')
                    .setDescription(`Hello <@${userId}>, congratulations! Your script request has been approved.`)
                    .addFields(
                        { name: 'Status', value: 'Approved', inline: true },
                        { name: 'Note', value: 'It will be processed and added to the database shortly.', inline: false }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();

                await channel.send({ content: `<@${userId}>`, embeds: [acceptEmbed] });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Secondary)
                );
                await channel.send({ content: "Ticket reviewed.", components: [row] });
            }
            await interaction.reply({ content: "Marked as Accepted.", ephemeral: true });
        }

        // 3. TICKET SYSTEM: Discard
        if (interaction.customId.startsWith('ticket_discard_')) {
            const [, , channelId, userId] = interaction.customId.split('_');
            const modal = new ModalBuilder()
                .setCustomId(`modal_discard_submit_${channelId}_${userId}`)
                .setTitle('Discard Reason');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason_input')
                .setLabel("Why is this being discarded?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(firstActionRow);
            await interaction.showModal(modal);
        }

        // 3. TICKET SYSTEM: Close
        if (interaction.customId === 'ticket_close') {
            await interaction.reply("Closing...");
            setTimeout(() => interaction.channel.delete(), 1200);
        }
// UPLOAD SYSTEM: Admin Reviews
        if (interaction.customId.startsWith('up_')) {
            // 1. DEFER IMMEDIATELY: Prevents "Unknown Interaction" crashes
            await interaction.deferReply({ ephemeral: true });

            try {
                // Parse ID: action_PublicMsgID_UserID
                const parts = interaction.customId.split('_');
                const action = parts[1]; // ver, uns, or dis
                const publicMsgId = parts[2];
                const userId = parts[3];

                const publicChannel = interaction.guild.channels.cache.find(c => c.name === 'user-verified-scripts');
                if (!publicChannel) return interaction.editReply({ content: "❌ Public channel not found." });

                let publicMsg;
                try {
                    publicMsg = await publicChannel.messages.fetch(publicMsgId);
                } catch (e) {
                    return interaction.editReply({ content: "❌ Original message not found (maybe already deleted)." });
                }

                // Create Ticket Function
                const createTicket = async (name, embedTitle, embedDesc, color) => {
                    // Shorten name to ensure it fits discord limits
                    const safeName = interaction.user.username.replace(/[^a-z0-9]/gi, '').substring(0, 5);
                    const ticketName = `review-${name}-${safeName}`.toLowerCase();
                    
                    const ticket = await interaction.guild.channels.create({
                        name: ticketName,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel] }, // The Uploader
                            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] } // The Admin
                        ]
                    });

                    const infoEmbed = new EmbedBuilder()
                        .setTitle(embedTitle)
                        .setDescription(embedDesc)
                        .setColor(color)
                        .setTimestamp();
                    
                    const closeRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Secondary)
                    );

                    await ticket.send({ content: `<@${userId}> <@${interaction.user.id}>`, embeds: [infoEmbed], components: [closeRow] });
                    return ticket;
                };

                // --- HANDLE ACTIONS ---

                // 1. VERIFY (Accept)
                if (action === 'ver') {
                    // Update Public Message
                    const newEmbed = EmbedBuilder.from(publicMsg.embeds[0])
                        .setDescription(`**Status:** ✅ Verified\n**Verified By:** ${interaction.user.tag}`)
                        .setColor(0x00FF00); // Green
                    
                    await publicMsg.edit({ embeds: [newEmbed] });
                    
                    // Update Admin Message (Remove buttons)
                    await interaction.message.edit({ content: "✅ **Verified.** Ticket opening...", components: [] });
                    
                    // Open Ticket
                    const t = await createTicket('verify', '✅ Upload Verified', `Congratulations <@${userId}>! Your script upload has been verified and is now live.`, 0x00FF00);
                    await interaction.editReply({ content: `✅ Verified. Ticket created: ${t}` });
                }

                // 2. DISCARD (Reject)
                if (action === 'dis') {
                    // Delete Public Message (Clean up)
                    await publicMsg.delete().catch(() => {});
                    
                    // Update Admin Message (Remove buttons)
                    await interaction.message.edit({ content: "🗑️ **Discarded.** Ticket opening...", components: [] });

                    // Open Ticket
                    const t = await createTicket('reject', '❌ Upload Discarded', `Hello <@${userId}>. Unfortunately, your script was discarded by the administration.`, 0xFF0000);
                    await interaction.editReply({ content: `🗑️ Discarded. Ticket created: ${t}` });
                }

                // 3. UNSURE (Discuss)
                if (action === 'uns') {
                    // Update Public Message
                    const newEmbed = EmbedBuilder.from(publicMsg.embeds[0])
                        .setDescription(`**Status:** ⚠️ Under Investigation\n**Reviewer:** ${interaction.user.tag}`)
                        .setColor(0xFFA500); // Orange
                    
                    await publicMsg.edit({ embeds: [newEmbed] });

                    // Update Admin Message (Remove buttons)
                    await interaction.message.edit({ content: "⚠️ **Marked Unsure.** Ticket opening...", components: [] });

                    // Open Ticket
                    const t = await createTicket('unsure', '⚠️ Upload Review', `Hello <@${userId}>. An admin has marked your upload as "Unsure". We need to discuss this script further.`, 0xFFA500);
                    await interaction.editReply({ content: `⚠️ Marked Unsure. Ticket created: ${t}` });
                }
            } catch (error) {
                console.error("Error in upload review:", error);
                // Safety catch so bot doesn't crash if something weird happens
                await interaction.editReply({ content: "❌ An internal error occurred while processing." }).catch(() => {});
            }
        }
        
        // 2. REVOKE SYSTEM
        if (interaction.customId.startsWith('revoke_confirm_')) {
            const targetId = interaction.customId.split('_')[2];
            const data = loadData();
            
            if (data.users[targetId] && data.users[targetId].key) {
                const revokedKey = data.users[targetId].key;
                delete data.users[targetId].key;
                
                data.revoked_keys.push({
                    user: data.users[targetId].username,
                    key: revokedKey,
                    admin: interaction.user.username,
                    time: new Date().toISOString()
                });
                saveData(data);

                const embed = new EmbedBuilder().setTitle("Revoked").setDescription("Key has been revoked.").setColor(0xFF0000);
                await interaction.update({ embeds: [embed], components: [] });
            } else {
                await interaction.update({ content: "Key already revoked or user data missing.", components: [] });
            }
        }
        if (interaction.customId === 'revoke_cancel') {
            await interaction.update({ content: "Cancelled.", components: [], embeds: [] });
        }

        // 3. TICKET SYSTEM: Accept
        if (interaction.customId.startsWith('ticket_accept_')) {
            const [, , channelId, userId] = interaction.customId.split('_');
            const channel = interaction.guild.channels.cache.get(channelId);
            
            if (channel) {
                const acceptEmbed = new EmbedBuilder()
                    .setTitle('✅ Request Accepted')
                    .setDescription(`Hello <@${userId}>, congratulations! Your script request has been approved.`)
                    .addFields(
                        { name: 'Status', value: 'Approved', inline: true },
                        { name: 'Note', value: 'It will be processed and added to the database shortly.', inline: false }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();

                await channel.send({ content: `<@${userId}>`, embeds: [acceptEmbed] });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Secondary)
                );
                await channel.send({ content: "Ticket reviewed.", components: [row] });
            }
            await interaction.reply({ content: "Marked as Accepted.", ephemeral: true });
        }

        // 3. TICKET SYSTEM: Discard
        if (interaction.customId.startsWith('ticket_discard_')) {
            const [, , channelId, userId] = interaction.customId.split('_');
            const modal = new ModalBuilder()
                .setCustomId(`modal_discard_submit_${channelId}_${userId}`)
                .setTitle('Discard Reason');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason_input')
                .setLabel("Why is this being discarded?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(firstActionRow);
            await interaction.showModal(modal);
        }

        // 3. TICKET SYSTEM: Close
        if (interaction.customId === 'ticket_close') {
            await interaction.reply("Closing...");
            setTimeout(() => interaction.channel.delete(), 1200);
        }

// 4. VERIFY SYSTEM (DUAL ROLE UPDATE: Verified + Uploader)
        if (interaction.customId === 'btn_check_verify') {
            const guild = interaction.guild;
            const uid = interaction.user.id;

            if (!guild) return interaction.reply({ content: "❌ Verification must be done in a server.", ephemeral: true });

            // 1. Load the PENDING file
            const pendingData = loadPending();
            const userRequest = pendingData[uid];

            if (!userRequest) {
                return interaction.reply({ 
                    content: "❌ **No Request Found.**\nPlease go to the website and click 'Verify Access' first.", 
                    ephemeral: true 
                });
            }

            // 2. STRICT CHECK: Username Mismatch
            if (userRequest.username !== interaction.user.username) {
                delete pendingData[uid];
                savePending(pendingData);

                return interaction.reply({ 
                    content: `❌ **Mismatch Detected!**\n\n**Website Input:** \`${userRequest.username}\`\n**Your Discord:** \`${interaction.user.username}\`\n\nI have deleted the bad request. Please try again with the correct username.`, 
                    ephemeral: true 
                });
            }

            // 3. SUCCESS - Assign Multiple Roles
            const member = interaction.member;
            const rolesToGive = ["Verified", "Uploader"]; // List of roles to assign
            
            try {
                // Loop through the list and add each role
                for (const name of rolesToGive) {
                    let role = guild.roles.cache.find(r => r.name === name);
                    
                    // Create the role if it doesn't exist
                    if (!role) {
                        role = await guild.roles.create({
                            name: name,
                            color: '#00FF00', 
                            reason: 'Auto-created for verification system.'
                        });
                    }
                    
                    // Add the role to the user
                    await member.roles.add(role);
                }
                
                // --- SAVE TO REAL DATA ---
                const mainData = loadData();
                if (!mainData.users[uid]) mainData.users[uid] = {};
                
                mainData.users[uid].verified = true;
                mainData.users[uid].username = interaction.user.username;
                mainData.users[uid].role_reward = "Verified, Uploader"; // Record both
                mainData.users[uid].timestamp = new Date().toISOString();
                
                saveData(mainData);

                // --- CLEANUP ---
                delete pendingData[uid];
                savePending(pendingData);
                
                await interaction.reply({ content: `✅ **Verification Successful!**\n\nYou have been given the **Verified** and **Uploader** roles.`, ephemeral: true });

            } catch (e) {
                console.error("Role Assignment Error:", e);
                await interaction.reply({ content: `⚠️ Verified, but I failed to give roles. Please ensure my **Bot Role** is higher than the 'Verified' and 'Uploader' roles in Server Settings.`, ephemeral: true });
            }
        }

        // 5. UPLOAD SYSTEM (Admin review buttons)
        if (interaction.customId === 'upload_verify') {
            const embed = EmbedBuilder.from(interaction.message.embeds[0]);
            embed.setTitle(`${embed.data.title} ✅ (Verified)`);
            await interaction.message.edit({ embeds: [embed], components: [] });
            await interaction.reply({ content: "Script Verified.", ephemeral: true });
        }

        // 5. UPLOAD SYSTEM (Review Buttons)

        // Helper function to get script data and final message ID
        const getUploadData = (userId) => {
            const data = loadData();
            const userData = data.verify_site_data[userId];
            if (!userData || !userData.final_message_id) return { script: null, finalMessageId: null, data: data };

            return {
                script: userData.script_pending,
                gameName: userData.game_name,
                gameId: userData.game_id,
                finalMessageId: userData.final_message_id, // CRITICAL
                data: data 
            };
        };
        
        // Helper to remove pending script data from JSON
        const cleanupPendingData = (data, userId) => {
            if (data.verify_site_data[userId]) {
                delete data.verify_site_data[userId].script_pending;
                delete data.verify_site_data[userId].game_name;
                delete data.verify_site_data[userId].game_id;
                delete data.verify_site_data[userId].final_message_id;
                saveData(data);
            }
        };


        // Review: ACCEPT
        if (interaction.customId.startsWith('upload_review_accept_')) {
            await interaction.deferReply({ ephemeral: true });
            const userId = interaction.customId.split('_')[3];
            const { script, gameName, gameId, finalMessageId, data } = getUploadData(userId);
            const verifiedScriptsChannel = interaction.guild.channels.cache.find(c => c.name === 'user-verified-scripts');
            
            if (!verifiedScriptsChannel || !finalMessageId) {
                return interaction.editReply("❌ Error: Cannot find script data or final script message.");
            }
            
            try {
                const finalMsg = await verifiedScriptsChannel.messages.fetch(finalMessageId);
                
                // 1. Build Final Approved Embed
                const acceptedEmbed = EmbedBuilder.from(finalMsg.embeds[0])
                    .setTitle(`✅ [ADMIN VERIFIED] ${gameName}`)
                    .setDescription(`Submitted by <@${userId}> | Verified by ${interaction.user.tag}`)
                    .setColor(0x00FF00)
                    .setFooter({ text: `Verified by: ${interaction.user.tag}` });

                // 2. Update the message in the final scripts channel
                await finalMsg.edit({ embeds: [acceptedEmbed], components: [] });
                
                // 3. Update the message in the admin review channel
                const adminReviewEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setTitle(`✅ [ACCEPTED] ${gameName}`)
                    .setDescription(`Review Complete. Accepted by ${interaction.user.tag}.`)
                    .setColor(0x00FF00);

                await interaction.message.edit({ embeds: [adminReviewEmbed], components: [] });

                // 4. Clean up pending script data
                cleanupPendingData(data, userId);

                interaction.editReply("Script successfully accepted and marked as verified in the final channel.");

            } catch (e) {
                console.error('Error during ACCEPT process:', e);
                interaction.editReply("❌ Failed to finalize verification. Check console for details.");
            }
        }

        // Review: DISCARD (Requires Modal for reason, creates ticket)
        if (interaction.customId.startsWith('upload_review_discard_')) {
            const userId = interaction.customId.split('_')[3];
            const { finalMessageId } = getUploadData(userId);

            const modal = new ModalBuilder()
                .setCustomId(`modal_discard_upload_submit_${userId}_${finalMessageId}`) // Embeds final message ID
                .setTitle('Discard Reason');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason_input')
                .setLabel("Why was this script discarded?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(firstActionRow);
            
            await interaction.showModal(modal); // Show the reason prompt
        }
        
        // Review: UNSURE
        if (interaction.customId.startsWith('upload_review_unsure_')) {
            await interaction.deferReply({ ephemeral: true });
            
            const unsureEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setTitle(`⚠️ [UNSURE - NEEDS SECOND OPINION]`)
                .setDescription(`Marked Unsure by ${interaction.user.tag}. Re-pinging admins.`)
                .setColor(0xF1C40F);
            
            const newContent = interaction.message.content.replace(/Pinging.*?/i, 'Pinging'); // Reset ping to default
            
            await interaction.message.edit({ 
                content: newContent, 
                embeds: [unsureEmbed] 
            });
            
            interaction.editReply("Marked as 'Unsure' and re-queued for administrative review.");
        }

        if (interaction.customId.startsWith('upload_discard_')) {
            const uploaderId = interaction.customId.split('_')[2];
            const data = loadData();
            
            if (!data.users[uploaderId]) data.users[uploaderId] = {};
            data.users[uploaderId].warnings = (data.users[uploaderId].warnings || 0) + 1;
            saveData(data);

            await interaction.message.delete();
            let msg = `<@${uploaderId}> Script discarded. Warnings: ${data.users[uploaderId].warnings}/5.`;
            if (data.users[uploaderId].warnings >= 5) {
                const member = interaction.guild.members.cache.get(uploaderId);
                const role = interaction.guild.roles.cache.find(r => r.name === "Uploader");
                if (member && role) await member.roles.remove(role);
                msg += " **Uploader role removed.**";
            }
            await interaction.channel.send(msg);
        }

        // 6. TEMPLATE GENERATOR
        if (templateSessions.has(interaction.user.id)) {
            const session = templateSessions.get(interaction.user.id);

            // Field Selection
            if (['tpl_gamename', 'tpl_name', 'tpl_icon', 'tpl_desc', 'tpl_load'].includes(interaction.customId)) {
                const map = { 'tpl_gamename': 'gamename', 'tpl_name': 'Name', 'tpl_icon': 'Icon', 'tpl_desc': 'Description', 'tpl_load': 'Load' };
                session.awaitingInput = map[interaction.customId];
                await interaction.reply({ content: `Please enter the **${map[interaction.customId]}** in the chat:`, ephemeral: true });
            }

            // Add (Go Multi)
            if (interaction.customId === 'tpl_add') {
                session.mode = 'multi';
                saveSessionSafe(interaction.user.id, session); // Uses fixed save
                await interaction.deferUpdate();
                updateTemplatePanel(session, interaction.channel);
            }

            // Finish
            if (interaction.customId === 'tpl_finish') {
                saveSessionSafe(interaction.user.id, session); // Uses fixed save
                const lua = formatLua(session.gamename, session.scripts);
                await interaction.message.delete();
                await interaction.channel.send(`**Template Generated:**\n\`\`\`lua\n${lua}\n\`\`\``);
                templateSessions.delete(interaction.user.id);
            }

            // Multi Nav: NEXT
            if (interaction.customId === 'tpl_next') {
                saveSessionSafe(interaction.user.id, session);
                session.index++;
                await interaction.deferUpdate();
                updateTemplatePanel(session, interaction.channel);
            }
            // Multi Nav: PREV
            if (interaction.customId === 'tpl_prev') {
                saveSessionSafe(interaction.user.id, session);
                session.index--;
                await interaction.deferUpdate();
                updateTemplatePanel(session, interaction.channel);
            }
            // Multi Nav: NEW ENTRY
            if (interaction.customId === 'tpl_new_entry') {
                session.scripts.push({ Name: "example", Icon: "https/example.jpg", Description: "example description", Load: "loadstring(example)" });
                session.index = session.scripts.length - 1;
                saveSessionSafe(interaction.user.id, session);
                await interaction.deferUpdate();
                updateTemplatePanel(session, interaction.channel);
            }
        }

        // 7. SAVES NAVIGATOR (Handles Navigation AND Deletion)
        if (interaction.customId.startsWith('saves_nav_') || interaction.customId.startsWith('saves_delete_')) {
            const data = loadData();
            const uid = interaction.user.id; 

            if (!data.users[uid] || !data.users[uid].saved_template) {
                return interaction.reply({ content: "No saves found.", ephemeral: true });
            }

            const saved = data.users[uid].saved_template;
            let keys = Object.keys(saved);

            // --- DELETE LOGIC ---
            if (interaction.customId.startsWith('saves_delete_')) {
                const deleteIndex = parseInt(interaction.customId.split('_')[2]);
                const gameToDelete = keys[deleteIndex];
                
                if (gameToDelete) {
                    delete saved[gameToDelete]; // Delete the specific game
                    
                    // Also clear last_save_game if the one deleted was the last saved game
                    if (data.users[uid].last_save_game === gameToDelete) {
                         delete data.users[uid].last_save_game;
                    }

                    saveData(data); // Save to file
                    keys = Object.keys(saved); // Refresh keys list
                }
                
                // If we deleted everything
                if (keys.length === 0) {
                    return interaction.update({ content: "🗑️ **Deleted.** No saves left.", embeds: [], components: [] });
                }

                // After delete, set targetIndex to be the first element, unless the one deleted was not the last.
                var targetIndex = (deleteIndex >= keys.length) ? keys.length - 1 : deleteIndex; // Adjusted logic to keep index valid
                if (targetIndex < 0) targetIndex = 0; // Failsafe
                
            } 
            else {
                // --- NAVIGATION LOGIC ---
                var targetIndex = parseInt(interaction.customId.split('_')[2]);
            }

            // Validate Index (for navigation)
            if (targetIndex < 0) targetIndex = 0;
            if (targetIndex >= keys.length) targetIndex = keys.length - 1;

            const gameName = keys[targetIndex];
            const scripts = saved[gameName];

            // Update Embed (Blue)
            const embed = new EmbedBuilder()
                .setTitle(`💾 Save: ${gameName}`)
                .setDescription(`**Entry ${targetIndex + 1}/${keys.length}**\n\`\`\`lua\n${formatLua(gameName, scripts)}\n\`\`\``)
                .setColor(0x0099FF)
                .setFooter({ text: `Hidden Index: ${targetIndex}` });
            
            // Set the last_save_game to the one the user just viewed/landed on (New Feature)
            data.users[uid].last_save_game = gameName;
            saveData(data);


            // Update Buttons
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`saves_nav_${targetIndex - 1}`)
                    .setLabel('◀ Back')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(targetIndex === 0),
                new ButtonBuilder()
                    .setCustomId(`saves_delete_${targetIndex}`)
                    .setLabel('Delete')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`saves_nav_${targetIndex + 1}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(targetIndex === keys.length - 1)
            );

            await interaction.update({ embeds: [embed], components: [row] });
        }
    }

    // ====================================================
    // PART 2: MODAL HANDLER
    // ====================================================
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_discard_submit_')) {
            const [, , , channelId, userId] = interaction.customId.split('_');
            const reason = interaction.fields.getTextInputValue('reason_input');
            const channel = interaction.guild.channels.cache.get(channelId);
            
            if (channel) {
                const discardEmbed = new EmbedBuilder()
                    .setTitle('❌ Request Discarded')
                    .setDescription(`Hello <@${userId}>, your script request has been reviewed by the administration.`)
                    .addFields(
                        { name: 'Status', value: 'Declined', inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();

                await channel.send({ content: `<@${userId}>`, embeds: [discardEmbed] });
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Secondary)
                );
                await channel.send({ content: "Ticket reviewed.", components: [row] });
            }
            await interaction.reply({ content: `Ticket discarded with reason: ${reason}`, ephemeral: true });
        }
    }
});

// --- UPDATE TEMPLATE PANEL FUNCTION ---
async function updateTemplatePanel(session, channel) {
    const scriptEntry = session.scripts[session.index];
    
    let luaDisplay = `    ["${session.gamename}"] = {\n`;
    luaDisplay += `        {\n`;
    luaDisplay += `            Name = "${scriptEntry.Name}",\n`;
    luaDisplay += `            Icon = "${scriptEntry.Icon}",\n`;
    luaDisplay += `            Description = "${scriptEntry.Description}",\n`;
    luaDisplay += `            Load = ${scriptEntry.Load}\n`;
    luaDisplay += `        },\n`;
    luaDisplay += `    },`;

    
    const embed = new EmbedBuilder()
        .setTitle("Template Generator")
        .setDescription(`**Game:** ${session.gamename}\n**Mode:** ${session.mode.toUpperCase()} | **Entry:** ${session.index + 1}/${session.scripts.length}\n\`\`\`lua\n${luaDisplay}\n\`\`\``)
        .setColor(0x0099FF);

    // Rows
    const rows = [];

    // Row 1: Fields
    const rowFields = new ActionRowBuilder();
    if (session.mode === 'single' || session.index === 0) { // Keep gamename editable if single or on first entry
        rowFields.addComponents(
            new ButtonBuilder().setCustomId('tpl_gamename').setLabel('Game Name').setStyle(ButtonStyle.Secondary)
        );
    }
    
    // Always include script fields
    rowFields.addComponents(
        new ButtonBuilder().setCustomId('tpl_name').setLabel('Script Name').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tpl_icon').setLabel('Icon').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tpl_desc').setLabel('Desc').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tpl_load').setLabel('Loadstring').setStyle(ButtonStyle.Secondary)
    );
    
    rows.push(rowFields);

    // Row 2: Controls
    const rowControls = new ActionRowBuilder();
    if (session.mode === 'single' && session.scripts.length === 1) { // True single mode
        rowControls.addComponents(
            new ButtonBuilder().setCustomId('tpl_add').setLabel('Go Multi').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('tpl_finish').setLabel('Finish & Save').setStyle(ButtonStyle.Success)
        );
    } else {
        // Multi Controls
        rowControls.addComponents(
            new ButtonBuilder().setCustomId('tpl_prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(session.index === 0),
            new ButtonBuilder().setCustomId('tpl_next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(session.index >= session.scripts.length - 1),
            new ButtonBuilder().setCustomId('tpl_new_entry').setLabel('Add New #').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('tpl_finish').setLabel('Finish & Save').setStyle(ButtonStyle.Success)
        );
    }
    rows.push(rowControls);

    // Edit message
    try {
        const msg = await channel.messages.fetch(session.messageId);
        if (msg) await msg.edit({ embeds: [embed], components: rows });
    } catch (e) {
        console.log("Error updating panel:", e);
    }
}

// Utility to find admin role or just tag here
function getErrorRole(guild) {
    // Tries to find an Admin role, otherwise returns 'here'
    const role = guild.roles.cache.find(r => r.permissions.has(PermissionsBitField.Flags.Administrator));
    return role ? role.id : 'here';
}

// --- TERMINAL CONTROL PANEL ---
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("------------------------------------------------");
console.log("Terminal Ready. Type 'help' for commands.");
console.log("------------------------------------------------");

rl.on('line', async (input) => {
    const args = input.trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const settings = loadSettings();

    // COMMAND: SET STATUS (Controls Startup)
    if (cmd === 'setstatus') {
        // Usage: setstatus <online|idle|dnd|invisible> <play|watch|listen|compete> <text>
        const status = args[0]?.toLowerCase();
        const typeInput = args[1]?.toLowerCase();
        const text = args.slice(2).join(" ");

        if (!status) {
            console.log("Usage: setstatus <online|idle|dnd> <play|watch|listen|compete> <text>");
            return;
        }

        // Map text input to ActivityType enum
        let activityType = ActivityType.Playing;
        if (typeInput === 'watch') activityType = ActivityType.Watching;
        if (typeInput === 'listen') activityType = ActivityType.Listening;
        if (typeInput === 'compete') activityType = ActivityType.Competing;

        try {
            client.user.setPresence({
                status: status,
                activities: text ? [{ name: text, type: activityType }] : []
            });
            console.log(`✅ Status updated: ${status.toUpperCase()} | ${typeInput ? typeInput : 'None'} ${text ? text : ''}`);
        } catch (e) {
            console.log("❌ Error setting status:", e.message);
        }
    }

    // COMMAND: LIST SERVERS
    else if (cmd === 'list') {
        guildCache = []; 
        console.log("\n--- SERVER LIST ---");
        let i = 1;
        client.guilds.cache.forEach(g => {
            const status = settings.disabledGuilds.includes(g.id) ? "[DISABLED]" : "[ACTIVE]";
            console.log(`${i}. ${g.name} (ID: ${g.id}) | Members: ${g.memberCount} ${status}`);
            guildCache.push(g);
            i++;
        });
        console.log("-------------------\n");
    }

    // COMMAND: LEAVE SERVER (New)
    else if (cmd === 'leave') {
        const index = parseInt(args[0]) - 1;
        if (guildCache[index]) {
            const g = guildCache[index];
            console.log(`⚠️  Leaving server: ${g.name}...`);
            await g.leave();
            console.log("✅ Left successfully.");
        } else {
            console.log("❌ Invalid number. Run 'list' first.");
        }
    }

    // COMMAND: DM USER (New)
    else if (cmd === 'dm') {
        // Usage: dm <user_id> <message>
        const userId = args[0];
        const content = args.slice(1).join(" ");
        
        if (!userId || !content) {
            console.log("Usage: dm <user_id> <message>");
            return;
        }

        try {
            const user = await client.users.fetch(userId);
            await user.send(content);
            console.log(`📤 DM Sent to ${user.tag}`);
        } catch (e) {
            console.log("❌ Could not send DM (User might have DMs off or invalid ID).");
        }
    }

    // COMMAND: DISABLE SERVER
    else if (cmd === 'disable') {
        const index = parseInt(args[0]) - 1;
        if (guildCache[index]) {
            const g = guildCache[index];
            if (!settings.disabledGuilds.includes(g.id)) {
                settings.disabledGuilds.push(g.id);
                saveBotSettings(settings);
                console.log(`❌ Disabled bot in: ${g.name}`);
            } else {
                console.log("⚠️  Already disabled.");
            }
        } else {
            console.log("Invalid number. Run 'list' first.");
        }
    }

    // COMMAND: ENABLE SERVER
    else if (cmd === 'enable') {
        const index = parseInt(args[0]) - 1;
        if (guildCache[index]) {
            const g = guildCache[index];
            if (settings.disabledGuilds.includes(g.id)) {
                settings.disabledGuilds = settings.disabledGuilds.filter(id => id !== g.id);
                saveBotSettings(settings);
                console.log(`✅ Enabled bot in: ${g.name}`);
            } else {
                console.log("⚠️  Already active.");
            }
        } else {
            console.log("Invalid number. Run 'list' first.");
        }
    }

    // COMMAND: STATUS / INFO
    else if (cmd === 'status' || cmd === 'info') {
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        
        console.log(`\n--- SYSTEM INFO ---`);
        console.log(`User: ${client.user ? client.user.tag : 'Offline'}`);
        console.log(`Guilds: ${client.guilds.cache.size}`);
        console.log(`Uptime: ${h}h ${m}m`);
        console.log(`Current Presence: ${client.user?.presence?.status || 'invisible'}`);
        console.log("-------------------\n");
    }

    // COMMAND: RESTART
    else if (cmd === 'restart') {
        console.log("🔄 Restarting...");
        client.destroy();
        setTimeout(() => {
            client.login(TOKEN);
            console.log("✅ Re-logged in (Status reset to invisible).");
        }, 1000);
    }

    // COMMAND: QUIT
    else if (cmd === 'quit' || cmd === 'exit') {
        console.log("Shutting down...");
        process.exit(0);
    }

    else if (cmd === 'help') {
        console.log(`
        --- COMMANDS ---
        setstatus <mode> <type> <text>  :: Go online (e.g. setstatus online play Roblox)
        list                            :: List all servers
        leave <#>                       :: Leave a server (use number from list)
        disable <#> / enable <#>        :: Block/Unblock a server
        dm <id> <text>                  :: Send DM to user
        status                          :: View bot stats
        restart                         :: Re-login bot
        quit                            :: Stop process
        `);
    }

    else {
        console.log("Unknown command. Type 'help'.");
    }
});
// --- ANTI-CRASH HANDLERS ---
process.on('unhandledRejection', (reason, p) => {
    console.log(' [Anti-Crash] :: Unhandled Rejection/Catch');
    console.log(reason, p);
});

process.on("uncaughtException", (err, origin) => {
    console.log(' [Anti-Crash] :: Uncaught Exception/Catch');
    console.log(err, origin);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.log(' [Anti-Crash] :: Uncaught Exception/Catch (MONITOR)');
    console.log(err, origin);
});
// --- START ---
client.login(TOKEN);