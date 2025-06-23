// Unified WebRTC Camera Manager
import { BrowserEventEmitter } from './BrowserEventEmitter';
import {
  UnifiedCameraSource,
  SignalingMessage,
  WebRTCManagerConfig,
  WebRTCManagerEvents,
  DEFAULT_RTC_CONFIG,
  CAMERA_CONSTRAINTS,
  CameraQuality
} from '@/types/webrtc';

export class WebRTCManager extends BrowserEventEmitter {
  public config: WebRTCManagerConfig;
  private signalingSocket: WebSocket | null = null;
  private sources = new Map<string, UnifiedCameraSource>();
  private isConnected = false;
  private reconnectAttempts = 0;
  private statsIntervals = new Map<string, number>();

  constructor(config: Partial<WebRTCManagerConfig>) {
    super();
    this.config = {
      signalingUrl: config.signalingUrl || 'ws://localhost:8000/ws/webrtc',
      rtcConfiguration: config.rtcConfiguration || DEFAULT_RTC_CONFIG,
      autoReconnect: config.autoReconnect ?? true,
      statsInterval: config.statsInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
    };
  }

  // ==================== Connection Management ====================

  async connect(): Promise<void> {
    try {
      console.log('🔗 Connecting to WebRTC signaling server:', this.config.signalingUrl);
      
      this.signalingSocket = new WebSocket(this.config.signalingUrl);
      
      this.signalingSocket.onopen = () => {
        console.log('✅ WebRTC signaling connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      };
      
      this.signalingSocket.onmessage = (event) => {
        this.handleSignalingMessage(JSON.parse(event.data));
      };
      
      this.signalingSocket.onclose = () => {
        console.log('🔌 WebRTC signaling disconnected');
        this.isConnected = false;
        this.emit('disconnected');
        
        if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`🔄 Reconnecting attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`);
          setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
        }
      };
      
      this.signalingSocket.onerror = (error) => {
        console.error('❌ WebRTC signaling error:', error);
        this.emit('error', error);
      };
      
    } catch (error) {
      console.error('Failed to connect to signaling server:', error);
      throw error;
    }
  }

  disconnect(): void {
    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }
    
    // Close all peer connections
    this.sources.forEach(source => {
      this.removeCamera(source.id);
    });
    
    this.isConnected = false;
  }

  // ==================== Local Camera Management ====================

  async addLocalCamera(deviceId: string, name: string, quality: CameraQuality = 'medium'): Promise<string> {
    // Check if camera with this deviceId already exists
    const existingSource = Array.from(this.sources.values()).find(source => source.deviceId === deviceId);
    if (existingSource) {
      console.log(`⚠️ Camera with deviceId ${deviceId} already exists: ${existingSource.name}`);
      return existingSource.id;
    }
    
    const sourceId = `local_${deviceId}_${Date.now()}`;
    
    console.log(`🎥 Adding local camera: ${name} (${deviceId})`);
    
    try {
      // Get camera stream
      const constraints = CAMERA_CONSTRAINTS[quality];
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: constraints.width },
          height: { ideal: constraints.height },
          frameRate: { ideal: constraints.fps }
        }
      });

      // Create peer connection for local streaming
      const peerConnection = new RTCPeerConnection(this.config.rtcConfiguration);
      
      // Add stream to peer connection
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      // Setup peer connection event handlers
      this.setupPeerConnectionHandlers(peerConnection, sourceId);

      // Create camera source
      const source: UnifiedCameraSource = {
        id: sourceId,
        type: 'local',
        name,
        deviceId,
        stream,
        peerConnection,
        status: 'connected',
        width: constraints.width,
        height: constraints.height,
        fps: constraints.fps,
        lastSeen: new Date().toISOString(),
        errorCount: 0
      };

      this.sources.set(sourceId, source);
      this.startStatsCollection(sourceId);
      
      console.log(`✅ Local camera added: ${name} (${sourceId})`);
      this.emit('camera-added', source);
      this.emit('camera-connected', sourceId, stream);
      
      return sourceId;
      
    } catch (error) {
      console.error(`❌ Failed to add local camera ${name}:`, error);
      throw error;
    }
  }

  // ==================== Remote Camera Management (Future) ====================

  async addRemoteCamera(peerId: string, name: string): Promise<string> {
    const sourceId = `remote_${peerId}_${Date.now()}`;
    
    console.log(`📡 Adding remote camera: ${name} (${peerId})`);
    
    // This will be implemented for remote cameras
    // For now, return placeholder
    throw new Error('Remote cameras not implemented yet');
  }

  // ==================== Camera Operations ====================

  async updateCamera(sourceId: string, updates: Partial<UnifiedCameraSource>): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Camera ${sourceId} not found for update`);
    }

    console.log(`🔧 Updating camera: ${source.name} (${sourceId})`, updates);

    // Create updated source
    const updatedSource = { ...source, ...updates };
    
    // If updating stream-related properties, update the peer connection
    if (updates.stream && source.peerConnection) {
      const sender = source.peerConnection.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      if (sender && updates.stream.getVideoTracks()[0]) {
        await sender.replaceTrack(updates.stream.getVideoTracks()[0]);
      }
    }

    // Update in sources map
    this.sources.set(sourceId, updatedSource);
    
    // Emit update event
    this.emit('camera-updated', sourceId, updatedSource);
  }

  removeCamera(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      console.warn(`Camera ${sourceId} not found for removal`);
      return;
    }

    console.log(`🗑️ Removing camera: ${source.name} (${sourceId})`);

    // Stop stats collection
    this.stopStatsCollection(sourceId);

    // Close peer connection
    if (source.peerConnection) {
      source.peerConnection.close();
    }

    // Stop media stream
    if (source.stream) {
      source.stream.getTracks().forEach(track => track.stop());
    }

    this.sources.delete(sourceId);
    this.emit('camera-removed', sourceId);
  }

  getCamera(sourceId: string): UnifiedCameraSource | undefined {
    return this.sources.get(sourceId);
  }

  getAllCameras(): UnifiedCameraSource[] {
    return Array.from(this.sources.values());
  }

  getLocalCameras(): UnifiedCameraSource[] {
    return this.getAllCameras().filter(source => source.type === 'local');
  }

  getRemoteCameras(): UnifiedCameraSource[] {
    return this.getAllCameras().filter(source => source.type === 'remote');
  }

  // ==================== Streaming ====================

  getStream(sourceId: string): MediaStream | null {
    const source = this.sources.get(sourceId);
    return source?.stream || null;
  }

  async createStreamingOffer(sourceId: string): Promise<RTCSessionDescriptionInit> {
    const source = this.sources.get(sourceId);
    if (!source || !source.peerConnection) {
      throw new Error(`Camera ${sourceId} not found or not connected`);
    }

    const offer = await source.peerConnection.createOffer();
    await source.peerConnection.setLocalDescription(offer);
    
    return offer;
  }

  async handleStreamingAnswer(sourceId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || !source.peerConnection) {
      throw new Error(`Camera ${sourceId} not found or not connected`);
    }

    await source.peerConnection.setRemoteDescription(answer);
  }

  async addIceCandidate(sourceId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || !source.peerConnection) {
      console.warn(`Cannot add ICE candidate: Camera ${sourceId} not found`);
      return;
    }

    await source.peerConnection.addIceCandidate(candidate);
  }

  // ==================== Private Methods ====================

  private setupPeerConnectionHandlers(peerConnection: RTCPeerConnection, sourceId: string): void {
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'ice-candidate',
          sourceId,
          payload: { candidate: event.candidate },
          timestamp: Date.now()
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const source = this.sources.get(sourceId);
      if (source) {
        console.log(`🔗 Connection state changed for ${sourceId}:`, peerConnection.connectionState);
        
        switch (peerConnection.connectionState) {
          case 'connected':
            source.status = 'connected';
            this.emit('camera-connected', sourceId, source.stream!);
            break;
          case 'disconnected':
          case 'failed':
            source.status = 'disconnected';
            this.emit('camera-disconnected', sourceId);
            break;
          case 'connecting':
            source.status = 'connecting';
            break;
        }
      }
    };

    peerConnection.onicecandidateerror = (event) => {
      console.error(`ICE candidate error for ${sourceId}:`, event);
      const source = this.sources.get(sourceId);
      if (source) {
        source.errorCount++;
        this.emit('camera-error', sourceId, new Error(`ICE candidate error: ${event.errorText}`));
      }
    };
  }

  private handleSignalingMessage(message: SignalingMessage): void {
    console.log('📨 Received signaling message:', message.type, 'for source:', message.sourceId);
    
    switch (message.type) {
      case 'offer':
        // Handle incoming offers (for remote cameras)
        break;
      case 'answer':
        this.handleStreamingAnswer(message.sourceId, message.payload.sdp);
        break;
      case 'ice-candidate':
        this.addIceCandidate(message.sourceId, message.payload.candidate);
        break;
      case 'error':
        console.error('Signaling error:', message.payload);
        this.emit('camera-error', message.sourceId, new Error(message.payload.error));
        break;
    }
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    if (this.signalingSocket && this.isConnected) {
      this.signalingSocket.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send signaling message: not connected');
    }
  }

  private startStatsCollection(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source || !source.peerConnection) return;

    const interval = setInterval(async () => {
      try {
        const stats = await source.peerConnection!.getStats();
        source.qualityStats = stats;
        this.emit('stats-updated', sourceId, stats);
      } catch (error) {
        console.error(`Failed to collect stats for ${sourceId}:`, error);
      }
    }, this.config.statsInterval);

    this.statsIntervals.set(sourceId, interval);
  }

  private stopStatsCollection(sourceId: string): void {
    const interval = this.statsIntervals.get(sourceId);
    if (interval) {
      clearInterval(interval);
      this.statsIntervals.delete(sourceId);
    }
  }

  // ==================== Utility Methods ====================

  isConnectedToSignaling(): boolean {
    return this.isConnected;
  }

  getConnectionStats(): { total: number; connected: number; local: number; remote: number } {
    const all = this.getAllCameras();
    return {
      total: all.length,
      connected: all.filter(s => s.status === 'connected').length,
      local: all.filter(s => s.type === 'local').length,
      remote: all.filter(s => s.type === 'remote').length
    };
  }
}

// Export singleton instance
export const webRTCManager = new WebRTCManager({});