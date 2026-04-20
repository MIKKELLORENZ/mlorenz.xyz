// ========================================
// NETWORK.JS - Multiplayer Networking
// Mall Walk '92 - Vaporwave Experience
// WebRTC + WebSocket Signaling
// ========================================

export class NetworkManager {
    constructor() {
        this.ws = null;
        this.localId = null;
        this.playerName = 'VISITOR';
        this.peers = new Map(); // peerId -> { connection, dataChannel, audioStream }
        this.remotePlayers = new Map(); // peerId -> { name, position, rotation, color, headColor, isTalking }
        
        // Callbacks
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onPlayerUpdate = null;
        this.onConnectionStatusChange = null;
        this.onDayNightChange = null;  // Callback for day/night sync
        
        // Local state
        this.localPosition = { x: 0, y: 1.7, z: 30 };
        this.localRotation = 0;
        this.localColor = this.generateRandomColor();
        this.headColor = this.generateHeadColor(this.localColor);
        
        // Voice chat
        this.localStream = null;
        this.isTalking = false;
        this.audioContext = null;
        this.audioPanners = new Map(); // peerId -> { source, gain, panner }
        
        // Connection status
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10; // Increased from 5 for high-latency users
        
        // Heartbeat/keepalive for latency tolerance
        this.heartbeatInterval = null;
        this.lastServerResponse = 0;
        this.heartbeatPeriod = 10000;     // Send heartbeat every 10 seconds
        this.connectionTimeout = 60000;   // Consider dead after 60 seconds of no response
        
        // Update rate limiting - reduced from 20/sec to 10/sec for better performance
        this.lastUpdateTime = 0;
        this.updateInterval = 100; // 10 updates per second (was 50ms/20 per sec)
        
        // Server URL - default to localhost, can be configured
        this.serverUrl = this.getServerUrl();
    }
    
    getServerUrl() {
        // Check for custom server in URL params or use localhost
        const params = new URLSearchParams(window.location.search);
        const customServer = params.get('server');
        if (customServer) {
            return customServer;
        }
        // Default to same host and port (combined server)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        return `${protocol}//${window.location.hostname}:${port}`;
    }
    
    generateRandomColor() {
        // Generate vibrant vaporwave-style colors for body
        const colors = [
            0xff71ce, // neon pink
            0x01cdfe, // neon blue
            0x05ffa1, // neon green
            0xb967ff, // neon purple
            0xff7f50, // coral
            0x00ced1, // teal
            0xfffb96, // neon yellow
            0xdda0dd, // soft purple
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    generateHeadColor(bodyColor) {
        // Generate a lighter shade for the head
        const r = ((bodyColor >> 16) & 0xff);
        const g = ((bodyColor >> 8) & 0xff);
        const b = (bodyColor & 0xff);
        
        // Lighten by blending with white
        const factor = 0.4;
        const newR = Math.min(255, Math.floor(r + (255 - r) * factor));
        const newG = Math.min(255, Math.floor(g + (255 - g) * factor));
        const newB = Math.min(255, Math.floor(b + (255 - b) * factor));
        
        return (newR << 16) | (newG << 8) | newB;
    }
    
    async connect(playerName) {
        this.playerName = playerName || 'VISITOR';
        
        return new Promise((resolve, reject) => {
            try {
                console.log(`Connecting to signaling server: ${this.serverUrl}`);
                
                // Clear any existing heartbeat
                this.stopHeartbeat();
                
                this.ws = new WebSocket(this.serverUrl);
                
                // Set a connection timeout for slow networks
                const connectionTimeout = setTimeout(() => {
                    if (!this.isConnected) {
                        console.log('Connection timeout - server may be unreachable');
                        this.ws.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 30000); // 30 second timeout for initial connection
                
                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    console.log('Connected to signaling server');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.lastServerResponse = Date.now();
                    
                    // Start heartbeat to keep connection alive
                    this.startHeartbeat();
                    
                    // Send join message
                    this.send({
                        type: 'join',
                        name: this.playerName,
                        color: this.localColor,
                        headColor: this.headColor,
                        position: this.localPosition,
                        rotation: this.localRotation
                    });
                    
                    if (this.onConnectionStatusChange) {
                        this.onConnectionStatusChange(true);
                    }
                    
                    resolve();
                };
                
                this.ws.onmessage = (event) => {
                    // Track last response for connection health
                    this.lastServerResponse = Date.now();
                    this.handleMessage(JSON.parse(event.data));
                };
                
                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log(`Disconnected from signaling server (code: ${event.code}, reason: ${event.reason || 'none'})`);
                    this.isConnected = false;
                    this.stopHeartbeat();
                    
                    if (this.onConnectionStatusChange) {
                        this.onConnectionStatusChange(false);
                    }
                    
                    // Attempt reconnect (more aggressive for high-latency users)
                    this.attemptReconnect();
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    if (!this.isConnected) {
                        clearTimeout(connectionTimeout);
                        reject(new Error('Failed to connect to server'));
                    }
                };
                
            } catch (error) {
                console.error('Connection error:', error);
                reject(error);
            }
        });
    }
    
    // Start heartbeat to keep connection alive and detect stale connections
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            if (!this.isConnected || !this.ws) return;
            
            const timeSinceResponse = Date.now() - this.lastServerResponse;
            
            // Check if connection seems dead
            if (timeSinceResponse > this.connectionTimeout) {
                console.log(`Connection appears dead (no response for ${Math.round(timeSinceResponse/1000)}s) - reconnecting...`);
                this.ws.close();
                return;
            }
            
            // Send a lightweight ping message to keep connection alive
            // This helps with NAT traversal and proxy timeouts
            this.send({ type: 'ping' });
            
        }, this.heartbeatPeriod);
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached. Click to retry connection.');
            // Still allow manual reconnect by clicking
            if (this.onConnectionStatusChange) {
                this.onConnectionStatusChange(false, 'max_retries');
            }
            return;
        }
        
        this.reconnectAttempts++;
        // More gradual backoff: 2s, 4s, 6s, 8s, 10s, then cap at 15s
        // This is gentler for high-latency connections
        const delay = Math.min(2000 * this.reconnectAttempts, 15000);
        
        console.log(`Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connect(this.playerName).catch((error) => {
                console.log('Reconnect failed:', error.message);
                // Will trigger another reconnect via onclose
            });
        }, delay);
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'welcome':
                this.localId = data.id;
                console.log(`Received local ID: ${this.localId}`);
                break;
                
            case 'players':
                // Initial list of players already in the room
                data.players.forEach(player => {
                    if (player.id !== this.localId) {
                        this.addRemotePlayer(player);
                        // Create peer connection - we are polite if our ID is greater
                        const isPolite = this.localId > player.id;
                        this.createPeerConnection(player.id, isPolite);
                    }
                });
                break;
                
            case 'player-joined':
                if (data.player.id !== this.localId) {
                    this.addRemotePlayer(data.player);
                    // Create peer connection - we are polite if our ID is greater
                    const isPolite = this.localId > data.player.id;
                    this.createPeerConnection(data.player.id, isPolite);
                }
                break;
                
            case 'player-left':
                this.removeRemotePlayer(data.id);
                break;
                
            case 'player-update':
                this.updateRemotePlayer(data);
                break;
                
            case 'offer':
                this.handleOffer(data);
                break;
                
            case 'answer':
                this.handleAnswer(data);
                break;
                
            case 'ice-candidate':
                this.handleIceCandidate(data);
                break;
            
            case 'day-night':
                // Handle day/night mode sync from server
                console.log(`Received day-night sync: ${data.isNight ? 'Night' : 'Day'} mode from ${data.from || 'server'}`);
                if (this.onDayNightChange) {
                    this.onDayNightChange(data.isNight, data.from);
                } else {
                    console.log('Warning: onDayNightChange callback not set');
                }
                break;
            
            case 'pong':
                // Server responded to our heartbeat ping
                // lastServerResponse is already updated in onmessage handler
                break;
        }
    }
    
    addRemotePlayer(player) {
        this.remotePlayers.set(player.id, {
            name: player.name,
            position: player.position || { x: 0, y: 1.7, z: 30 },
            rotation: player.rotation || 0,
            color: player.color || 0xff71ce,
            headColor: player.headColor || 0xffaadd,
            isTalking: false
        });
        
        if (this.onPlayerJoin) {
            this.onPlayerJoin(player.id, this.remotePlayers.get(player.id));
        }
        
        console.log(`Player joined: ${player.name} (${player.id})`);
    }
    
    removeRemotePlayer(playerId) {
        const player = this.remotePlayers.get(playerId);
        
        // Close peer connection
        const peer = this.peers.get(playerId);
        if (peer) {
            if (peer.connection) peer.connection.close();
            this.peers.delete(playerId);
        }
        
        // Clean up audio panner
        this.audioPanners.delete(playerId);
        
        // Remove audio element
        const audioEl = document.getElementById(`audio-${playerId}`);
        if (audioEl) audioEl.remove();
        
        this.remotePlayers.delete(playerId);
        
        if (this.onPlayerLeave) {
            this.onPlayerLeave(playerId);
        }
        
        if (player) {
            console.log(`Player left: ${player.name}`);
        }
    }
    
    updateRemotePlayer(data) {
        const player = this.remotePlayers.get(data.id);
        if (player) {
            if (data.position) {
                player.position = data.position;
                
                // Throttle spatial audio updates (every 3rd update per player)
                if (!player._audioUpdateCounter) player._audioUpdateCounter = 0;
                player._audioUpdateCounter++;
                if (player._audioUpdateCounter >= 3) {
                    player._audioUpdateCounter = 0;
                    this.updateSpatialAudio(data.id, data.position);
                }
            }
            if (data.rotation !== undefined) player.rotation = data.rotation;
            if (data.isTalking !== undefined) player.isTalking = data.isTalking;
            
            if (this.onPlayerUpdate) {
                this.onPlayerUpdate(data.id, player);
            }
        }
    }
    
    // Calculate distance-based volume and stereo pan
    updateSpatialAudio(peerId, remotePosition) {
        const audioPanner = this.audioPanners.get(peerId);
        if (!audioPanner || !audioPanner.gain) return;
        
        // Calculate distance from local player
        const dx = remotePosition.x - this.localPosition.x;
        const dy = remotePosition.y - this.localPosition.y;
        const dz = remotePosition.z - this.localPosition.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Distance-based volume with smooth curve
        // Full volume at 0-3 units, fades to 0 at 35 units
        const minDistance = 3;    // Full volume within this range
        const maxDistance = 35;   // Silent beyond this
        
        let volume;
        if (distance <= minDistance) {
            volume = 1.0;
        } else if (distance >= maxDistance) {
            volume = 0.0;
        } else {
            // Smooth exponential falloff
            const normalizedDist = (distance - minDistance) / (maxDistance - minDistance);
            volume = Math.pow(1 - normalizedDist, 2); // Quadratic falloff for noticeable fade
        }
        
        // Apply volume with smooth transition
        audioPanner.gain.gain.setTargetAtTime(volume, this.audioContext.currentTime, 0.1);
        
        // Calculate stereo pan based on relative X position (-1 = left, 1 = right)
        // Only consider horizontal distance for pan
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        if (horizontalDist > 0.1 && audioPanner.panner.pan) {
            // Calculate angle to remote player and convert to pan value
            const pan = Math.max(-1, Math.min(1, dx / Math.max(horizontalDist, 10)));
            audioPanner.panner.pan.setTargetAtTime(pan, this.audioContext.currentTime, 0.1);
        }
    }
    
    // Send local player update
    sendUpdate(position, rotation) {
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateInterval) {
            return; // Rate limit updates
        }
        this.lastUpdateTime = now;
        
        this.localPosition = position;
        this.localRotation = rotation;
        
        // Update audio listener position for spatial audio
        if (this.audioContext && this.audioContext.listener) {
            const listener = this.audioContext.listener;
            if (listener.positionX) {
                // Modern API
                listener.positionX.value = position.x;
                listener.positionY.value = position.y;
                listener.positionZ.value = position.z;
            } else if (listener.setPosition) {
                // Legacy API
                listener.setPosition(position.x, position.y, position.z);
            }
        }
        
        this.send({
            type: 'update',
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            rotation: rotation,
            isTalking: this.isTalking
        });
    }
    
    // Send day/night mode change to all players
    sendDayNight(isNight) {
        this.send({
            type: 'day-night',
            isNight: isNight
        });
    }
    
    // WebRTC Peer Connection for voice chat
    // Using "Perfect Negotiation" pattern to handle glare
    async createPeerConnection(peerId, isPolite) {
        // isPolite determines who backs off in case of collision
        // The "polite" peer will rollback their offer if they receive one
        
        // Use multiple STUN servers and free TURN servers for better connectivity
        // Optimized for high-latency international connections
        // Simplified ICE configuration - fewer servers = faster connection
        const config = {
            iceServers: [
                // Primary STUN server (Google - fast, reliable)
                { urls: 'stun:stun.l.google.com:19302' },
                // Backup STUN
                { urls: 'stun:stun1.l.google.com:19302' },
                // TURN server for NAT traversal (essential for voice)
                {
                    urls: [
                        'turn:a.relay.metered.ca:80',
                        'turn:a.relay.metered.ca:443'
                    ],
                    username: 'e8c914bfcbdb0ed63f81e271',
                    credential: 'pNL/6OsuXBxBVfOz'
                }
            ],
            iceCandidatePoolSize: 2, // Reduced from 10 - faster initial connection
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
        const connection = new RTCPeerConnection(config);
        
        const peer = {
            connection,
            dataChannel: null,
            audioStream: null,
            isPolite: isPolite,  // Store politeness for negotiation
            makingOffer: false,  // Track if we're in the middle of making an offer
            ignoreOffer: false   // Track if we should ignore incoming offers
        };
        
        this.peers.set(peerId, peer);
        
        // Log connection state changes for debugging
        connection.onconnectionstatechange = () => {
            console.log(`Peer ${peerId} connection state: ${connection.connectionState}`);
            if (connection.connectionState === 'failed') {
                console.log('Connection failed - attempting to restart ICE');
                connection.restartIce();
            } else if (connection.connectionState === 'disconnected') {
                // Give disconnected peers time to recover (important for high-latency)
                console.log(`Peer ${peerId} disconnected - waiting for reconnection...`);
                setTimeout(() => {
                    if (connection.connectionState === 'disconnected') {
                        console.log(`Peer ${peerId} still disconnected after timeout - restarting ICE`);
                        connection.restartIce();
                    }
                }, 10000); // Wait 10 seconds before restarting ICE
            } else if (connection.connectionState === 'connected') {
                console.log(`✓ Successfully connected to ${peerId}!`);
            }
        };
        
        connection.oniceconnectionstatechange = () => {
            console.log(`Peer ${peerId} ICE state: ${connection.iceConnectionState}`);
            if (connection.iceConnectionState === 'failed') {
                console.log('ICE connection failed - restarting');
                connection.restartIce();
            } else if (connection.iceConnectionState === 'disconnected') {
                // ICE disconnected is often temporary for high-latency connections
                console.log(`Peer ${peerId} ICE disconnected - may recover...`);
            } else if (connection.iceConnectionState === 'checking') {
                console.log(`Peer ${peerId} ICE checking - gathering candidates...`);
            }
        };
        
        // Monitor ICE gathering state (useful for debugging high-latency issues)
        connection.onicegatheringstatechange = () => {
            console.log(`Peer ${peerId} ICE gathering state: ${connection.iceGatheringState}`);
        };
        
        // Perfect negotiation pattern - handle offers/answers properly
        connection.onnegotiationneeded = async () => {
            try {
                peer.makingOffer = true;
                console.log(`Creating offer for ${peerId} (polite: ${peer.isPolite})`);
                await connection.setLocalDescription();
                this.send({
                    type: 'offer',
                    target: peerId,
                    sdp: connection.localDescription
                });
            } catch (error) {
                console.error('Error in negotiationneeded:', error);
            } finally {
                peer.makingOffer = false;
            }
        };
        
        // Handle ICE candidates
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.send({
                    type: 'ice-candidate',
                    target: peerId,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle incoming audio stream
        connection.ontrack = (event) => {
            console.log(`✓ Received audio track from ${peerId}`);
            peer.audioStream = event.streams[0];
            this.playRemoteAudio(peerId, event.streams[0]);
        };
        
        // Add local audio track if available and set low bitrate
        if (this.localStream) {
            console.log(`Adding local audio tracks to peer ${peerId}`);
            this.localStream.getAudioTracks().forEach(track => {
                const sender = connection.addTrack(track, this.localStream);
                // Set very low bitrate for retro dial-up feel (8kbps)
                this.setLowBitrate(sender);
            });
        }
        
        return peer;
    }
    
    async handleOffer(data) {
        const peerId = data.from;
        console.log(`Received offer from ${peerId}`);
        
        let peer = this.peers.get(peerId);
        if (!peer) {
            // We received an offer, so we are polite (we didn't initiate)
            peer = await this.createPeerConnection(peerId, true);
        }
        
        const connection = peer.connection;
        const offerCollision = peer.makingOffer || connection.signalingState !== 'stable';
        
        peer.ignoreOffer = !peer.isPolite && offerCollision;
        if (peer.ignoreOffer) {
            console.log(`Ignoring offer from ${peerId} due to collision (we are impolite)`);
            return;
        }
        
        try {
            // If we're in the middle of something, rollback
            if (offerCollision) {
                console.log(`Rolling back for offer from ${peerId}`);
                await Promise.all([
                    connection.setLocalDescription({ type: 'rollback' }),
                    connection.setRemoteDescription(data.sdp)
                ]);
            } else {
                await connection.setRemoteDescription(data.sdp);
            }
            
            // Add local tracks if available and not already added
            if (this.localStream) {
                const senders = connection.getSenders();
                const hasAudioTrack = senders.some(s => s.track && s.track.kind === 'audio');
                if (!hasAudioTrack) {
                    console.log(`Adding local audio to answer for ${peerId}`);
                    this.localStream.getAudioTracks().forEach(track => {
                        const sender = connection.addTrack(track, this.localStream);
                        this.setLowBitrate(sender);
                    });
                }
            }
            
            await connection.setLocalDescription();
            console.log(`Sending answer to ${peerId}`);
            this.send({
                type: 'answer',
                target: peerId,
                sdp: connection.localDescription
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(data) {
        const peerId = data.from;
        console.log(`Received answer from ${peerId}`);
        
        const peer = this.peers.get(peerId);
        if (!peer) {
            console.log(`No peer found for answer from ${peerId}`);
            return;
        }
        
        try {
            if (peer.connection.signalingState === 'have-local-offer') {
                await peer.connection.setRemoteDescription(data.sdp);
                console.log(`✓ Answer processed for ${peerId}`);
            } else {
                console.log(`Ignoring answer from ${peerId} - wrong state: ${peer.connection.signalingState}`);
            }
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
    
    async handleIceCandidate(data) {
        const peer = this.peers.get(data.from);
        if (!peer) return;
        
        try {
            if (data.candidate) {
                await peer.connection.addIceCandidate(data.candidate);
            }
        } catch (error) {
            // Only log if not a benign error
            if (!peer.ignoreOffer) {
                console.log('ICE candidate error (may be benign):', error.message);
            }
        }
    }
    
    // Set very low bitrate for retro dial-up audio quality (8kbps)
    async setLowBitrate(sender) {
        if (!sender || sender.track?.kind !== 'audio') return;
        
        try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            
            // Set maximum bitrate to 24kbps - more reliable than 8kbps while still low
            // 8kbps caused issues with some WebRTC implementations
            params.encodings[0].maxBitrate = 24000; // 24 kbps (was 8kbps)
            params.encodings[0].priority = 'high';
            params.encodings[0].networkPriority = 'high';
            
            await sender.setParameters(params);
            console.log('✓ Audio bitrate set to 24kbps');
        } catch (error) {
            console.log('Could not set bitrate:', error.message);
        }
    }
    
    playRemoteAudio(peerId, stream) {
        console.log(`Setting up audio playback for ${peerId}`);
        
        // Remove existing audio element if any
        const existingAudio = document.getElementById(`audio-${peerId}`);
        if (existingAudio) {
            existingAudio.remove();
        }
        
        // Create audio element for remote player
        const audio = document.createElement('audio');
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.playsInline = true;  // Important for mobile
        audio.muted = false;       // Ensure not muted
        audio.volume = 1.0;        // Full volume
        audio.id = `audio-${peerId}`;
        
        // Append early so it's in the DOM
        document.body.appendChild(audio);
        
        // Ensure audio plays (needed due to autoplay restrictions)
        const tryPlay = () => {
            audio.play().then(() => {
                console.log(`✓ Audio playing for ${peerId}`);
            }).catch(e => {
                console.log(`Audio autoplay blocked for ${peerId}:`, e.message);
            });
        };
        
        tryPlay();
        
        // Also try on user interaction if autoplay was blocked
        const playOnInteraction = () => {
            audio.play().then(() => {
                console.log(`✓ Audio now playing for ${peerId} after interaction`);
            }).catch(() => {});
        };
        document.addEventListener('click', playOnInteraction, { once: true });
        document.addEventListener('touchstart', playOnInteraction, { once: true });
        
        // Apply spatial audio processing
        if (this.audioContext) {
            try {
                // Resume audio context if needed
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                
                const source = this.audioContext.createMediaStreamSource(stream);
                
                // Create gain node for manual distance-based volume control
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = 1.0;
                
                // Create panner for stereo positioning (left/right)
                const pannerNode = this.audioContext.createStereoPanner();
                pannerNode.pan.value = 0; // Center by default
                
                // Connect: source -> gain -> panner -> destination
                source.connect(gainNode);
                gainNode.connect(pannerNode);
                pannerNode.connect(this.audioContext.destination);
                
                // Store for position updates with distance-based volume
                this.audioPanners.set(peerId, { 
                    source, 
                    gain: gainNode, 
                    panner: pannerNode,
                    lastPosition: null
                });
                console.log(`Spatial audio set up for ${peerId}`);
            } catch (e) {
                console.log('Spatial audio setup failed, using standard playback:', e);
            }
        }
    }
    
    // Initialize voice chat with low bitrate
    async initVoiceChat() {
        try {
            console.log('Initializing voice chat...');
            
            // Check if mediaDevices is available (requires HTTPS or localhost)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.error('Voice chat unavailable: mediaDevices API not available.');
                console.error('This usually means the page is served over HTTP instead of HTTPS.');
                console.error('Voice chat requires HTTPS (except on localhost).');
                
                // Show user-friendly message
                if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    alert('Voice chat requires HTTPS. Please access this site via HTTPS to use voice chat.');
                }
                return false;
            }
            
            // Create audio context for processing
            // Note: Use default sample rate for better compatibility - low bitrate encoding handles retro feel
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    latencyHint: 'interactive' // Prioritize low latency over quality
                });
            }
            
            // Resume audio context (required after user gesture)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log('Audio context resumed');
            }
            
            // Request microphone with better quality settings
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                }
            });
            
            console.log('Microphone access granted');
            
            // Mute local audio by default
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
                console.log('Audio track:', track.label, track.readyState);
            });
            
            // Add tracks to existing peer connections and renegotiate
            const renegotiatePromises = [];
            this.peers.forEach((peer, peerId) => {
                console.log(`Adding audio track to existing peer ${peerId}`);
                this.localStream.getAudioTracks().forEach(track => {
                    // Check if track already added
                    const senders = peer.connection.getSenders();
                    const hasAudioTrack = senders.some(s => s.track && s.track.kind === 'audio');
                    if (!hasAudioTrack) {
                        peer.connection.addTrack(track, this.localStream);
                    }
                });
                // Renegotiate
                renegotiatePromises.push(this.renegotiate(peerId));
            });
            
            await Promise.all(renegotiatePromises);
            
            console.log('Voice chat initialized successfully');
            return true;
            
        } catch (error) {
            console.error('Failed to initialize voice chat:', error);
            if (error.name === 'NotAllowedError') {
                console.log('Microphone permission denied by user');
            } else if (error.name === 'NotFoundError') {
                console.log('No microphone found');
            } else if (error.name === 'TypeError') {
                console.log('Voice chat API not available - HTTPS required');
            }
            return false;
        }
    }
    
    async renegotiate(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) {
            console.log(`Cannot renegotiate - peer ${peerId} not found`);
            return;
        }
        
        // The onnegotiationneeded event will fire automatically when we add tracks
        // So we don't need to manually create offers here
        // Just log that we're expecting renegotiation
        console.log(`Tracks added for ${peerId} - onnegotiationneeded will handle offer`);
    }
    
    // Push-to-talk: Start talking
    startTalking() {
        if (!this.localStream) {
            console.log('Cannot talk - voice chat not initialized. Initializing now...');
            this.initVoiceChat().then(() => {
                if (this.localStream) {
                    this.startTalking();
                }
            });
            return;
        }
        
        this.isTalking = true;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = true;
            console.log(`Audio track enabled: ${track.label}, state: ${track.readyState}`);
        });
        
        // Send talking state
        this.send({
            type: 'update',
            position: this.localPosition,
            rotation: this.localRotation,
            isTalking: true
        });
        
        console.log(`Started talking - connected to ${this.peers.size} peers`);
    }
    
    // Push-to-talk: Stop talking
    stopTalking() {
        if (!this.localStream) return;
        
        this.isTalking = false;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
        
        // Send talking state
        this.send({
            type: 'update',
            position: this.localPosition,
            rotation: this.localRotation,
            isTalking: false
        });
        
        console.log('Stopped talking');
    }
    
    // Audio loopback test - hear your own voice (R key)
    isLoopbackEnabled = false;
    loopbackAudio = null;
    loopbackSource = null;
    loopbackGain = null;
    loopbackDelay = null;
    
    startLoopback() {
        if (!this.localStream) {
            console.log('Voice chat not initialized - trying to initialize now');
            // Try to initialize voice chat first
            this.initVoiceChat().then(() => {
                if (this.localStream) {
                    this.startLoopback();
                } else {
                    console.log('Could not get microphone access');
                }
            });
            return false;
        }
        
        if (this.isLoopbackEnabled) return true; // Already enabled
        
        try {
            // Create audio context if needed
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 8000
                });
            }
            
            // Resume audio context if suspended (important!)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    console.log('Audio context resumed for loopback');
                });
            }
            
            // Create source from local stream
            this.loopbackSource = this.audioContext.createMediaStreamSource(this.localStream);
            
            // Create gain node for volume control
            this.loopbackGain = this.audioContext.createGain();
            this.loopbackGain.gain.value = 0.8; // Audible volume for testing
            
            // Add a slight delay for more natural feel and to reduce feedback
            this.loopbackDelay = this.audioContext.createDelay(0.3);
            this.loopbackDelay.delayTime.value = 0.15; // 150ms delay for clearer distinction
            
            // Connect: source -> delay -> gain -> output
            this.loopbackSource.connect(this.loopbackDelay);
            this.loopbackDelay.connect(this.loopbackGain);
            this.loopbackGain.connect(this.audioContext.destination);
            
            // Enable the mic for testing
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
                console.log('Mic track enabled:', track.label, track.readyState);
            });
            
            this.isLoopbackEnabled = true;
            console.log('Loopback enabled - you should hear yourself now');
            return true;
            
        } catch (error) {
            console.error('Failed to enable loopback:', error);
            return false;
        }
    }
    
    stopLoopback() {
        if (!this.isLoopbackEnabled) return;
        
        // Disconnect loopback nodes
        if (this.loopbackSource) {
            this.loopbackSource.disconnect();
            this.loopbackSource = null;
        }
        if (this.loopbackDelay) {
            this.loopbackDelay.disconnect();
            this.loopbackDelay = null;
        }
        if (this.loopbackGain) {
            this.loopbackGain.disconnect();
            this.loopbackGain = null;
        }
        
        // Disable mic unless actively talking
        if (!this.isTalking && this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        this.isLoopbackEnabled = false;
        console.log('Loopback disabled');
    }
    
    // Legacy toggle method for button click
    toggleLoopback() {
        if (this.isLoopbackEnabled) {
            this.stopLoopback();
        } else {
            this.startLoopback();
        }
        return this.isLoopbackEnabled;
    }
    
    getPlayerCount() {
        return this.remotePlayers.size + 1; // +1 for local player
    }
    
    getRemotePlayers() {
        return this.remotePlayers;
    }
    
    // Debug function to check voice chat status
    debugVoiceChat() {
        console.log('=== VOICE CHAT DEBUG ===');
        console.log(`Local stream: ${this.localStream ? 'YES' : 'NO'}`);
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                console.log(`  Local track: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`);
            });
        }
        console.log(`Audio context: ${this.audioContext ? this.audioContext.state : 'NONE'}`);
        console.log(`Is talking: ${this.isTalking}`);
        console.log(`Connected peers: ${this.peers.size}`);
        
        this.peers.forEach((peer, peerId) => {
            const conn = peer.connection;
            console.log(`\nPeer ${peerId}:`);
            console.log(`  Connection state: ${conn.connectionState}`);
            console.log(`  ICE state: ${conn.iceConnectionState}`);
            console.log(`  Signaling state: ${conn.signalingState}`);
            
            const senders = conn.getSenders();
            console.log(`  Senders: ${senders.length}`);
            senders.forEach((s, i) => {
                console.log(`    [${i}] ${s.track ? s.track.kind + ' - ' + s.track.label : 'no track'}`);
            });
            
            const receivers = conn.getReceivers();
            console.log(`  Receivers: ${receivers.length}`);
            receivers.forEach((r, i) => {
                if (r.track) {
                    console.log(`    [${i}] ${r.track.kind} - enabled: ${r.track.enabled}, state: ${r.track.readyState}`);
                }
            });
            
            // Check audio element
            const audioEl = document.getElementById(`audio-${peerId}`);
            if (audioEl) {
                console.log(`  Audio element: paused=${audioEl.paused}, muted=${audioEl.muted}, volume=${audioEl.volume}`);
            } else {
                console.log(`  Audio element: NOT FOUND`);
            }
        });
        
        console.log('========================');
        return {
            localStream: !!this.localStream,
            audioContext: this.audioContext?.state,
            peers: this.peers.size,
            isTalking: this.isTalking
        };
    }

    dispose() {
        // Stop heartbeat
        this.stopHeartbeat();
        
        // Disable loopback
        this.stopLoopback();
        
        // Close all peer connections
        this.peers.forEach((peer) => {
            if (peer.connection) peer.connection.close();
        });
        this.peers.clear();
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        // Close WebSocket
        if (this.ws) {
            this.ws.close();
        }
        
        // Remove audio elements
        this.remotePlayers.forEach((_, id) => {
            const audio = document.getElementById(`audio-${id}`);
            if (audio) audio.remove();
        });
        
        this.remotePlayers.clear();
    }
}

export default NetworkManager;
