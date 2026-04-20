// ========================================
// SERVER.JS - Combined HTTPS + WebSocket Server
// Mall Walk '92 - Multiplayer Support
// Run with: node server.js
// ========================================

const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.env.USE_HTTPS !== 'false'; // Default to HTTPS

// Latency tolerance settings (for users with high ping)
const PING_INTERVAL = 15000;        // Send ping every 15 seconds
const PONG_TIMEOUT = 45000;         // Wait 45 seconds for pong before considering dead
const CONNECTION_TIMEOUT = 60000;   // Give new connections 60 seconds to complete handshake

// MIME types for serving static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

// Generate self-signed certificate if needed
function generateSelfSignedCert() {
    const certPath = path.join(__dirname, 'cert.pem');
    const keyPath = path.join(__dirname, 'key.pem');
    
    // Check if certs already exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        };
    }
    
    console.log('Generating self-signed certificate...');
    
    // Generate using Node's crypto (requires Node 15+)
    try {
        const { generateKeyPairSync, createSign, X509Certificate } = crypto;
        
        // Generate key pair
        const { privateKey, publicKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        
        // For self-signed cert, we need to use OpenSSL or a library
        // Since Node doesn't have built-in X509 generation, we'll create a simple one
        // This requires running openssl command or using a package
        
        console.log('\n⚠️  Self-signed certificate generation requires OpenSSL.');
        console.log('   Run this command to generate certificates:\n');
        console.log('   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"\n');
        console.log('   Or install mkcert for trusted local certificates:\n');
        console.log('   1. Install: choco install mkcert  (or download from github.com/FiloSottile/mkcert)');
        console.log('   2. Run: mkcert -install');
        console.log('   3. Run: mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1\n');
        
        return null;
    } catch (error) {
        console.log('Could not auto-generate certificates:', error.message);
        return null;
    }
}

// Request handler for static files
function handleRequest(req, res) {
    // Handle CORS for development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Parse URL and get file path
    let filePath = req.url === '/' ? '/index.html' : req.url;
    
    // Remove query string if present
    filePath = filePath.split('?')[0];
    
    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('500 Internal Server Error');
            }
            return;
        }
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// Create server (HTTPS or HTTP)
let server;
let protocol = 'http';

if (USE_HTTPS) {
    const certPath = path.join(__dirname, 'cert.pem');
    const keyPath = path.join(__dirname, 'key.pem');
    
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        // Use existing certificates
        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        server = https.createServer(options, handleRequest);
        protocol = 'https';
        console.log('✓ Using HTTPS with existing certificates');
    } else {
        // Try to generate or show instructions
        generateSelfSignedCert();
        console.log('⚠️  No certificates found. Falling back to HTTP.');
        console.log('   Voice chat will only work on localhost.\n');
        server = http.createServer(handleRequest);
    }
} else {
    server = http.createServer(handleRequest);
    console.log('Running in HTTP mode (USE_HTTPS=false)');
}

// Create WebSocket server on the same HTTP server
const wss = new WebSocket.Server({ server });

// Store connected players
const players = new Map(); // id -> { ws, name, position, rotation, color, headColor, lastActivity, isAlive }

// Global state
let isNightMode = false;

// Track pending connections (before join message)
const pendingConnections = new Map(); // ws -> { id, connectedAt, isAlive }

// Generate unique ID
function generateId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

// Start the combined server
server.listen(PORT, () => {
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const voiceStatus = protocol === 'https' ? '✓ Voice chat enabled' : '⚠️  Voice chat: localhost only';
    console.log(`
╔══════════════════════════════════════════════════════╗
║         MALL WALK '92 - MULTIPLAYER SERVER           ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  🌐 Game URL:     ${protocol}://localhost:${PORT}              ║
║  🔌 WebSocket:    ${wsProtocol}://localhost:${PORT}                ║
║                                                      ║
║  ${voiceStatus.padEnd(44)}║
║                                                      ║
║  Open the URL above in your browser to play!         ║
║  Open multiple tabs for multiplayer testing.         ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
});

wss.on('connection', (ws) => {
    const playerId = generateId();
    
    console.log(`[+] New connection: ${playerId}`);
    
    // Track connection state for latency tolerance
    ws.isAlive = true;
    ws.playerId = playerId;
    ws.connectedAt = Date.now();
    
    // Add to pending connections until they send join message
    pendingConnections.set(ws, {
        id: playerId,
        connectedAt: Date.now(),
        isAlive: true
    });
    
    // Handle pong responses (proof of life)
    ws.on('pong', () => {
        ws.isAlive = true;
        const player = players.get(playerId);
        if (player) {
            player.isAlive = true;
            player.lastActivity = Date.now();
        }
    });
    
    // Handle messages
    ws.on('message', (data) => {
        ws.isAlive = true; // Any message counts as activity
        const player = players.get(playerId);
        if (player) {
            player.lastActivity = Date.now();
            player.isAlive = true;
        }
        
        try {
            const message = JSON.parse(data);
            handleMessage(playerId, ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    // Handle disconnect
    ws.on('close', (code, reason) => {
        pendingConnections.delete(ws);
        const player = players.get(playerId);
        if (player) {
            const connectionDuration = Math.round((Date.now() - ws.connectedAt) / 1000);
            console.log(`[-] Player disconnected: ${player.name} (${playerId}) after ${connectionDuration}s - code: ${code}`);
            players.delete(playerId);
            
            // Notify all other players
            broadcast({
                type: 'player-left',
                id: playerId
            }, playerId);
        } else {
            console.log(`[-] Pending connection closed: ${playerId} - code: ${code}`);
        }
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error.message || error);
    });
});

function handleMessage(playerId, ws, message) {
    switch (message.type) {
        case 'join':
            // Remove from pending connections
            pendingConnections.delete(ws);
            
            // Register new player with activity tracking
            players.set(playerId, {
                ws,
                name: message.name || 'VISITOR',
                position: message.position || { x: 0, y: 1.7, z: 30 },
                rotation: message.rotation || 0,
                color: message.color || 0xff71ce,
                headColor: message.headColor || 0xffaadd,
                lastActivity: Date.now(),
                isAlive: true,
                joinedAt: Date.now()
            });
            
            console.log(`[*] Player joined: ${message.name} (${playerId})`);
            console.log(`    Players online: ${players.size}`);
            
            // Send welcome with player ID
            send(ws, {
                type: 'welcome',
                id: playerId
            });
            
            // Send current day/night state
            send(ws, {
                type: 'day-night',
                isNight: isNightMode
            });
            
            // Send list of existing players
            const existingPlayers = [];
            players.forEach((player, id) => {
                if (id !== playerId) {
                    existingPlayers.push({
                        id,
                        name: player.name,
                        position: player.position,
                        rotation: player.rotation,
                        color: player.color,
                        headColor: player.headColor
                    });
                }
            });
            
            send(ws, {
                type: 'players',
                players: existingPlayers
            });
            
            // Notify all other players about new player
            const newPlayer = players.get(playerId);
            broadcast({
                type: 'player-joined',
                player: {
                    id: playerId,
                    name: newPlayer.name,
                    position: newPlayer.position,
                    rotation: newPlayer.rotation,
                    color: newPlayer.color,
                    headColor: newPlayer.headColor
                }
            }, playerId);
            break;
            
        case 'update':
            // Update player position/state
            const player = players.get(playerId);
            if (player) {
                if (message.position) player.position = message.position;
                if (message.rotation !== undefined) player.rotation = message.rotation;
                
                // Broadcast to all other players
                broadcast({
                    type: 'player-update',
                    id: playerId,
                    position: message.position,
                    rotation: message.rotation,
                    isTalking: message.isTalking
                }, playerId);
            }
            break;
            
        case 'offer':
        case 'answer':
        case 'ice-candidate':
            // Relay WebRTC signaling to target peer
            const targetPlayer = players.get(message.target);
            if (targetPlayer) {
                send(targetPlayer.ws, {
                    ...message,
                    from: playerId
                });
            }
            break;
        
        case 'day-night':
            // Update global night mode state and broadcast to ALL players
            isNightMode = message.isNight;
            console.log(`[*] Day/Night toggled by ${playerId}: ${isNightMode ? 'Night' : 'Day'} mode`);
            
            // Broadcast to all players including sender for confirmation
            players.forEach((player, id) => {
                send(player.ws, {
                    type: 'day-night',
                    isNight: isNightMode,
                    from: playerId
                });
            });
            break;
        
        case 'ping':
            // Respond to heartbeat ping to keep connection alive
            // This is especially important for high-latency connections
            send(ws, { type: 'pong', timestamp: Date.now() });
            break;
            
        default:
            console.log(`Unknown message type: ${message.type}`);
    }
}

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(data, excludeId = null) {
    players.forEach((player, id) => {
        if (id !== excludeId) {
            send(player.ws, data);
        }
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Keep alive ping with latency-tolerant timeout handling
setInterval(() => {
    const now = Date.now();
    
    // Check pending connections for timeout
    pendingConnections.forEach((pending, ws) => {
        if (now - pending.connectedAt > CONNECTION_TIMEOUT) {
            console.log(`[!] Pending connection timeout: ${pending.id} (no join message after ${CONNECTION_TIMEOUT/1000}s)`);
            pendingConnections.delete(ws);
            ws.terminate();
        }
    });
    
    // Check active connections
    wss.clients.forEach((ws) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        if (ws.isAlive === false) {
            // No pong received since last ping - give them one more chance with a longer timeout
            const player = players.get(ws.playerId);
            const lastActivity = player ? player.lastActivity : ws.connectedAt;
            const timeSinceActivity = now - lastActivity;
            
            if (timeSinceActivity > PONG_TIMEOUT) {
                const playerName = player ? player.name : 'unknown';
                console.log(`[!] Connection timeout for ${playerName} (${ws.playerId}) - no response for ${Math.round(timeSinceActivity/1000)}s`);
                return ws.terminate();
            }
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);
